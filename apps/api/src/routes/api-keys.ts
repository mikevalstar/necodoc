import { zValidator } from "@hono/zod-validator";
import {
  type ApiKeyStatus,
  apiKeyListQuerySchema,
  apiKeyStatus,
  apiScopes,
  createApiKeySchema,
  DEFAULT_RATE_LIMIT_PER_HOUR,
  hasPermission,
  parseRoles,
  rotateApiKeySchema,
} from "@necodoc/shared";
import { and, desc, eq, gt, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createKey, revokeKey } from "../api-keys";
import { recordAudit } from "../audit";
import { db } from "../db";
import { apiKeyPolicy, apikey, user } from "../db/schema";
import {
  type AppEnv,
  authIdParam,
  demo,
  isAdmin,
  requirePermission,
  type SignedInEnv,
} from "../middleware";

// Spec: docs/features/html-to-pdf-api.md (keys). ADR 0029: people manage their own keys; admins
// manage service accounts' keys, and see and revoke everyone's.

type SignedInUser = SignedInEnv["Variables"]["user"];

const canUseApi = requirePermission({ document: ["view"] });

const statusWhere = (status: ApiKeyStatus, now = new Date()): SQL | undefined => {
  switch (status) {
    case "revoked":
      return isNotNull(apiKeyPolicy.revokedAt);
    case "expired":
      return and(isNull(apiKeyPolicy.revokedAt), lte(apiKeyPolicy.expiresAt, now));
    case "active":
      return and(
        isNull(apiKeyPolicy.revokedAt),
        or(isNull(apiKeyPolicy.expiresAt), gt(apiKeyPolicy.expiresAt, now)),
      );
  }
};

const selectKeys = (where: SQL | undefined) =>
  db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      rateLimitPerHour: apikey.rateLimitMax,
      ownerId: apikey.referenceId,
      ownerName: user.name,
      ownerIsService: user.serviceAccount,
      ownerDisabled: user.banned,
      scopes: apiKeyPolicy.scopes,
      templateIds: apiKeyPolicy.templateIds,
      ipAllowlist: apiKeyPolicy.ipAllowlist,
      expiresAt: apiKeyPolicy.expiresAt,
      revokedAt: apiKeyPolicy.revokedAt,
      rotatedFromId: apiKeyPolicy.rotatedFromId,
      requests: apiKeyPolicy.requests,
      lastUsedAt: apiKeyPolicy.lastUsedAt,
      lastUsedIp: apiKeyPolicy.lastUsedIp,
    })
    .from(apiKeyPolicy)
    .innerJoin(apikey, eq(apikey.id, apiKeyPolicy.apiKeyId))
    .innerJoin(user, eq(user.id, apikey.referenceId))
    .where(where)
    .orderBy(desc(apikey.createdAt))
    .limit(500)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        ownerIsService: row.ownerIsService === true,
        ownerDisabled: row.ownerDisabled === true,
        status: apiKeyStatus(row),
      })),
    );

async function findOwner(id: string) {
  const [row] = await db
    .select({
      id: user.id,
      role: user.role,
      banned: user.banned,
      serviceAccount: user.serviceAccount,
    })
    .from(user)
    .where(eq(user.id, id));
  return row ?? null;
}

/** People manage their own keys; admins manage service accounts'. */
const canManage = (actor: SignedInUser, owner: { id: string; serviceAccount: boolean | null }) =>
  owner.id === actor.id || (owner.serviceAccount === true && isAdmin(actor));

export const apiKeyRoutes = new Hono<AppEnv>()
  .get("/", canUseApi, zValidator("query", apiKeyListQuerySchema), async (c) => {
    const actor = c.get("user");
    const { all, ownerId, ownerKind, status } = c.req.valid("query");
    const everyone = all === "true" || (ownerId !== undefined && ownerId !== actor.id);
    if (everyone && !isAdmin(actor)) return c.json({ error: "Forbidden" }, 403);
    const owner = everyone ? ownerId : actor.id;
    const keys = await selectKeys(
      and(
        owner ? eq(apikey.referenceId, owner) : undefined,
        ownerKind === "service" ? eq(user.serviceAccount, true) : undefined,
        ownerKind === "user" ? sql`${user.serviceAccount} is not true` : undefined,
        status ? statusWhere(status) : undefined,
      ),
    );
    return c.json(keys, 200);
  })
  .post("/", canUseApi, demo.off, zValidator("json", createApiKeySchema), async (c) => {
    const actor = c.get("user");
    const { ownerId, name, expiresInDays, ...settings } = c.req.valid("json");
    const owner = await findOwner(ownerId ?? actor.id);
    if (!owner || !canManage(actor, owner)) return c.json({ error: "Owner not found" }, 404);
    if (owner.banned) return c.json({ error: "This account is disabled" }, 409);
    const roles = parseRoles(owner.role);
    const refused = settings.scopes.filter(
      (scope) => !hasPermission(roles, apiScopes[scope].needs),
    );
    if (refused.length) {
      return c.json({ error: `The owner's roles don't allow ${refused.join(", ")}` }, 422);
    }
    const keySettings = {
      name,
      ...settings,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    };
    const created = await createKey(owner.id, keySettings, { createdBy: actor.id });
    await recordAudit({
      action: "api_key.created",
      target: { id: created.id, name },
      after: { ...keySettings, ownerId: owner.id, start: created.start },
    });
    return c.json(created, 201);
  })
  .post(
    "/:id/rotate",
    canUseApi,
    demo.off,
    authIdParam,
    zValidator("json", rotateApiKeySchema),
    async (c) => {
      const actor = c.get("user");
      const [found] = await selectKeys(eq(apikey.id, c.req.valid("param").id));
      const owner = found && (await findOwner(found.ownerId));
      if (!found || !owner || !canManage(actor, owner)) {
        return c.json({ error: "Key not found" }, 404);
      }
      if (found.status !== "active") return c.json({ error: `This key is ${found.status}` }, 409);
      const now = Date.now();
      // The replacement lives as long as the original was meant to.
      const lifetime = found.expiresAt
        ? found.expiresAt.getTime() - found.createdAt.getTime()
        : null;
      const created = await createKey(
        owner.id,
        {
          name: found.name ?? "Rotated key",
          scopes: found.scopes,
          templateIds: found.templateIds,
          ipAllowlist: found.ipAllowlist,
          rateLimitPerHour: found.rateLimitPerHour ?? DEFAULT_RATE_LIMIT_PER_HOUR,
          expiresAt: lifetime ? new Date(now + lifetime) : null,
        },
        { createdBy: actor.id, rotatedFromId: found.id },
      );
      const overlapEnd = new Date(now + c.req.valid("json").overlapHours * 3_600_000);
      const oldExpiresAt =
        found.expiresAt && found.expiresAt < overlapEnd ? found.expiresAt : overlapEnd;
      await db
        .update(apiKeyPolicy)
        .set({ expiresAt: oldExpiresAt })
        .where(eq(apiKeyPolicy.apiKeyId, found.id));
      await recordAudit({
        action: "api_key.rotated",
        target: { id: found.id, name: found.name },
        before: { expiresAt: found.expiresAt },
        after: { expiresAt: oldExpiresAt },
        details: { replacedBy: created.id, replacementStart: created.start },
      });
      return c.json({ ...created, oldKeyExpiresAt: overlapEnd.toISOString() }, 201);
    },
  )
  .post("/:id/revoke", canUseApi, authIdParam, async (c) => {
    const actor = c.get("user");
    const [found] = await selectKeys(eq(apikey.id, c.req.valid("param").id));
    if (!found || (found.ownerId !== actor.id && !isAdmin(actor))) {
      return c.json({ error: "Key not found" }, 404);
    }
    if (found.status === "revoked") return c.json({ error: "This key is already revoked" }, 409);
    await revokeKey(found.id, actor.id);
    await recordAudit({
      action: "api_key.revoked",
      target: { id: found.id, name: found.name },
      details: { ownerId: found.ownerId, ownerName: found.ownerName },
    });
    return c.body(null, 204);
  });
