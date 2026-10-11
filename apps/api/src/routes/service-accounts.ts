import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  createServiceAccountSchema,
  parseRoles,
  updateServiceAccountSchema,
} from "@necodoc/shared";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { apiKeyPolicy, apikey, serviceAccount, session, user } from "../db/schema";
import { type AppEnv, requireRole } from "../middleware";

// ADR 0029; spec: docs/features/html-to-pdf-api.md (keys). A service account is a user row that
// can't sign in (auth.ts refuses its sessions) plus its service_account details. Admins only.

const idParam = zValidator("param", z.object({ id: z.string().min(1) }));

/** Never delivered: `.invalid` can't resolve (RFC 2606). Unique, because user.email is. */
const placeholderEmail = (id: string) => `${id}@service-accounts.necodoc.invalid`;

const activeKeys = db
  .select({ ownerId: apikey.referenceId, count: count().as("active_keys") })
  .from(apikey)
  .innerJoin(apiKeyPolicy, eq(apiKeyPolicy.apiKeyId, apikey.id))
  .where(
    and(
      isNull(apiKeyPolicy.revokedAt),
      sql`(${apiKeyPolicy.expiresAt} is null or ${apiKeyPolicy.expiresAt} > now())`,
    ),
  )
  .groupBy(apikey.referenceId)
  .as("active_keys");

const selectAccounts = () =>
  db
    .select({
      id: user.id,
      name: user.name,
      role: user.role,
      banned: user.banned,
      description: serviceAccount.description,
      contact: serviceAccount.contact,
      createdBy: serviceAccount.createdBy,
      createdAt: serviceAccount.createdAt,
      updatedAt: serviceAccount.updatedAt,
      activeKeys: sql<number>`coalesce(${activeKeys.count}, 0)`.mapWith(Number),
    })
    .from(serviceAccount)
    .innerJoin(user, eq(user.id, serviceAccount.userId))
    .leftJoin(activeKeys, eq(activeKeys.ownerId, user.id))
    .$dynamic();

const shape = ({ role, banned, ...row }: Awaited<ReturnType<typeof selectAccounts>>[number]) => ({
  ...row,
  roles: parseRoles(role),
  disabled: banned === true,
});

export const serviceAccountRoutes = new Hono<AppEnv>()
  .get("/", requireRole("admin"), async (c) => {
    const rows = await selectAccounts().orderBy(user.name);
    return c.json(rows.map(shape), 200);
  })
  .post("/", requireRole("admin"), zValidator("json", createServiceAccountSchema), async (c) => {
    const { name, description, contact, roles } = c.req.valid("json");
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id,
        name,
        email: placeholderEmail(id),
        emailVerified: false,
        role: roles.join(","),
        serviceAccount: true,
      });
      await tx
        .insert(serviceAccount)
        .values({ userId: id, description, contact, createdBy: c.get("user").id });
      await recordAudit(
        {
          action: "service_account.created",
          target: { id, name },
          after: { name, description, contact, roles },
        },
        tx,
      );
    });
    const [row] = await selectAccounts().where(eq(user.id, id));
    return row ? c.json(shape(row), 201) : c.json({ error: "Not created" }, 500);
  })
  .get("/:id", requireRole("admin"), idParam, async (c) => {
    const [row] = await selectAccounts().where(eq(user.id, c.req.valid("param").id));
    return row ? c.json(shape(row), 200) : c.json({ error: "Service account not found" }, 404);
  })
  .patch(
    "/:id",
    requireRole("admin"),
    idParam,
    zValidator("json", updateServiceAccountSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { name, roles, disabled, description, contact } = c.req.valid("json");
      const [existing] = await selectAccounts().where(eq(user.id, id));
      if (!existing) return c.json({ error: "Service account not found" }, 404);
      const updated = await db.transaction(async (tx) => {
        const [found] = await tx
          .update(serviceAccount)
          .set({
            ...(description !== undefined ? { description } : {}),
            ...(contact !== undefined ? { contact } : {}),
            updatedAt: new Date(),
          })
          .where(eq(serviceAccount.userId, id))
          .returning({ id: serviceAccount.userId });
        if (!found) return false;
        await tx
          .update(user)
          .set({
            updatedAt: new Date(),
            ...(name !== undefined ? { name } : {}),
            ...(roles !== undefined ? { role: roles.join(",") } : {}),
            // Disabling is the admin plugin's ban; keys check it on every call.
            ...(disabled !== undefined
              ? { banned: disabled, banReason: disabled ? "Service account disabled" : null }
              : {}),
          })
          .where(eq(user.id, id));
        // There shouldn't be any, but a disabled account keeps none.
        if (disabled) await tx.delete(session).where(eq(session.userId, id));
        return true;
      });
      if (!updated) return c.json({ error: "Service account not found" }, 404);
      const [row] = await selectAccounts().where(eq(user.id, id));
      if (row) {
        await recordAudit({
          action: "service_account.updated",
          target: { id, name: row.name },
          before: shape(existing),
          after: shape(row),
        });
      }
      return row ? c.json(shape(row), 200) : c.json({ error: "Service account not found" }, 404);
    },
  );
