import {
  type ApiScope,
  apiKeyStatus,
  apiScopes,
  hasPermission,
  parseRoles,
  type V1Error,
} from "@necodoc/shared";
import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { ipAllowed } from "./addresses";
import { auth } from "./auth";
import { db } from "./db";
import { apiKeyPolicy, apikey, user } from "./db/schema";
import { type AppEnv, clientIp, type SignedInEnv } from "./middleware";

// ADR 0019, ADR 0029; spec: docs/features/html-to-pdf-api.md (keys). The plugin checks the
// secret and the rate limit; api_key_policy decides whether the key may be used, and for what.

export type KeyCaller = {
  id: string;
  name: string;
  scopes: ApiScope[];
  /** Empty: every template the owner can see. */
  templateIds: string[];
  /** The person or service account the key acts as. */
  owner: SignedInEnv["Variables"]["user"];
};

export type ApiKeyEnv = { Variables: AppEnv["Variables"] & { apiKey: KeyCaller } };

/** The public error body (`Error` in the OpenAPI document). */
export function v1Error(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  error: string,
  extra: Omit<V1Error, "error" | "code"> = {},
) {
  return c.json({ error, code, ...extra } satisfies V1Error, status);
}

const rateLimitedSchema = z.object({
  code: z.literal("RATE_LIMITED"),
  details: z.object({ tryAgainIn: z.number() }),
});

/**
 * Authenticates an x-api-key and checks it holds `scope`, in that order, so an unknown key gets
 * 401 before a bad body gets 422. Every authenticated call counts toward the key's usage.
 */
export const requireScope = (scope: ApiScope) =>
  createMiddleware<ApiKeyEnv>(async (c, next) => {
    const secret = c.req.header("x-api-key");
    if (!secret) return v1Error(c, 401, "missing_key", "Send your API key in the x-api-key header");
    const verified = await auth.api.verifyApiKey({ body: { key: secret } });
    if (!verified.valid || !verified.key) {
      const limited = rateLimitedSchema.safeParse(verified.error);
      if (limited.success) {
        c.header(
          "Retry-After",
          String(Math.max(1, Math.ceil(limited.data.details.tryAgainIn / 1000))),
        );
        return v1Error(c, 429, "rate_limited", "Rate limit exceeded; retry after the wait");
      }
      // Revoking also disables the plugin's key, so it's refused before the policy is read.
      return verified.error?.code === "KEY_DISABLED"
        ? v1Error(c, 401, "key_revoked", "This API key has been revoked")
        : v1Error(c, 401, "invalid_key", "This API key isn't valid or has been revoked");
    }
    const [row] = await db
      .select({ policy: apiKeyPolicy, owner: user })
      .from(apiKeyPolicy)
      .innerJoin(user, eq(user.id, verified.key.referenceId))
      .where(eq(apiKeyPolicy.apiKeyId, verified.key.id));
    // A key made around our routes (no policy row) is refused: fail closed.
    if (!row) return v1Error(c, 401, "invalid_key", "This API key isn't valid or has been revoked");
    const status = apiKeyStatus(row.policy);
    if (status !== "active")
      return v1Error(
        c,
        401,
        `key_${status}`,
        `This API key has ${status === "expired" ? "expired" : "been revoked"}`,
      );
    if (row.owner.banned) {
      return v1Error(c, 401, "owner_disabled", "This key's account is disabled");
    }
    const ip = clientIp(c);
    if (!ipAllowed(row.policy.ipAllowlist, ip)) {
      return v1Error(c, 403, "ip_not_allowed", `This key can't be used from ${ip}`);
    }
    await db
      .update(apiKeyPolicy)
      .set({ requests: sql`${apiKeyPolicy.requests} + 1`, lastUsedAt: new Date(), lastUsedIp: ip })
      .where(eq(apiKeyPolicy.apiKeyId, row.policy.apiKeyId));
    if (!row.policy.scopes.includes(scope)) {
      return v1Error(c, 403, "missing_scope", `This key needs the ${scope} scope`);
    }
    if (!hasPermission(parseRoles(row.owner.role), apiScopes[scope].needs)) {
      return v1Error(
        c,
        403,
        "owner_forbidden",
        "This key's account no longer has the role it needs",
      );
    }
    c.set("apiKey", {
      id: row.policy.apiKeyId,
      name: verified.key.name ?? "",
      scopes: row.policy.scopes,
      templateIds: row.policy.templateIds,
      owner: row.owner,
    });
    await next();
  });

/** Whether the key may use this template (keys can be limited to some). */
export const templateAllowed = (key: KeyCaller, templateId: string) =>
  !key.templateIds.length || key.templateIds.includes(templateId);

// ---------------------------------------------------------------------------------------------
// Making and stopping keys (routes/api-keys.ts)

export type KeySettings = {
  name: string;
  scopes: ApiScope[];
  templateIds: string[];
  ipAllowlist: string[];
  rateLimitPerMinute: number;
  expiresAt: Date | null;
};

/** Creates the plugin's key and its policy. Returns the secret, which is never shown again. */
export async function createKey(
  ownerId: string,
  settings: KeySettings,
  meta: { createdBy: string; rotatedFromId?: string },
) {
  const created = await auth.api.createApiKey({
    body: {
      name: settings.name,
      userId: ownerId,
      rateLimitEnabled: true,
      rateLimitTimeWindow: 60_000,
      rateLimitMax: settings.rateLimitPerMinute,
    },
  });
  await db.insert(apiKeyPolicy).values({
    apiKeyId: created.id,
    scopes: settings.scopes,
    templateIds: settings.templateIds,
    ipAllowlist: settings.ipAllowlist,
    expiresAt: settings.expiresAt,
    createdBy: meta.createdBy,
    rotatedFromId: meta.rotatedFromId,
  });
  return { id: created.id, key: created.key, name: settings.name, start: created.start };
}

/** Stops a key now. The policy says so; the plugin's flag is set too, belt and braces. */
export async function revokeKey(keyId: string, revokedBy: string) {
  await db
    .update(apiKeyPolicy)
    .set({ revokedAt: new Date(), revokedBy })
    .where(eq(apiKeyPolicy.apiKeyId, keyId));
  await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, keyId));
  // Audit hook (docs/features/audit-log.md): record "API key revoked" here.
}
