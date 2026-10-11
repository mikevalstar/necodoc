import { apiKey } from "@better-auth/api-key";
import { API_KEY_PREFIX, ac, parseRoles, roles } from "@necodoc/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { and, eq, isNull, like, or } from "drizzle-orm";
import {
  adminChange,
  adminGuardError,
  emailChangeTarget,
  selfDeleteError,
  serviceAccountTarget,
} from "./admin-guard";
import { db } from "./db";
import { user } from "./db/schema";
import { env } from "./env";

// Unbanned users holding admin. The LIKE only narrows; parseRoles decides.
async function activeAdminIds() {
  const admins = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(and(like(user.role, "%admin%"), or(isNull(user.banned), eq(user.banned, false))));
  return new Set(admins.filter((a) => parseRoles(a.role).includes("admin")).map((a) => a.id));
}

async function isServiceAccount(id: string) {
  const [row] = await db
    .select({ serviceAccount: user.serviceAccount })
    .from(user)
    .where(eq(user.id, id));
  return row?.serviceAccount === true;
}

// Specs: docs/features/user-management-and-roles.md, docs/features/user-preferences.md
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // No email provider yet: no verification, no reset-by-email. Admins set passwords.
  emailAndPassword: { enabled: true },
  // ADR 0029: keys are created and changed only through routes/api-keys.ts, which call the
  // plugin server-side; its own HTTP endpoints would bypass scopes and revocation.
  disabledPaths: [
    "/api-key/create",
    "/api-key/update",
    "/api-key/delete",
    "/api-key/get",
    "/api-key/list",
  ],
  user: {
    additionalFields: {
      /** ADR 0029: a non-human identity that owns API keys and can never sign in. */
      serviceAccount: { type: "boolean", defaultValue: false, required: false, input: false },
    },
    deleteUser: {
      enabled: true,
      // Runs on every self-delete path, after the password check. A failed lookup throws: fail closed.
      beforeDelete: async ({ id }) => {
        const error = selfDeleteError(id, await activeAdminIds());
        if (error) throw APIError.from("BAD_REQUEST", { message: error, code: "ADMIN_GUARD" });
      },
    },
  },
  plugins: [
    // defaultRole "" means "no roles": new sign-ups are pending until an admin grants access.
    admin({
      ac,
      roles,
      adminRoles: ["admin"],
      defaultRole: "",
      bannedUserMessage:
        "Your account has been banned. Ask an admin if you think this is a mistake.",
    }),
    // ADR 0019/0029: hashing, lookup and the per-key rate limit. Expiry, scopes and revocation
    // live in api_key_policy (the plugin deletes expired keys; we keep them listed).
    apiKey({
      defaultPrefix: API_KEY_PREFIX,
      startingCharactersConfig: { charactersLength: API_KEY_PREFIX.length + 6 },
      maximumNameLength: 100,
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      enableSessionForAPIKeys: false,
    }),
  ],
  databaseHooks: {
    // Service accounts never get a session: not by password (they have none), not by
    // impersonation, not by any plugin added later.
    session: {
      create: {
        before: async (data) => {
          const [owner] = await db
            .select({ serviceAccount: user.serviceAccount })
            .from(user)
            .where(eq(user.id, data.userId));
          if (owner?.serviceAccount) {
            throw APIError.from("FORBIDDEN", {
              message: "Service accounts can't sign in.",
              code: "SERVICE_ACCOUNT",
            });
          }
        },
      },
    },
    user: {
      create: {
        // Runs after the admin plugin's hook (plugins first, then ours), so this wins.
        before: async (data) => {
          if ((await db.$count(user)) > 0) return;
          return { data: { ...data, role: "admin" } };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const serviceTarget = serviceAccountTarget(ctx.path, ctx.body);
      if (serviceTarget && (await isServiceAccount(serviceTarget))) {
        throw APIError.from("BAD_REQUEST", {
          message: "Manage service accounts from Admin > Service accounts.",
          code: "SERVICE_ACCOUNT",
        });
      }
      const change = adminChange(ctx.path, ctx.body);
      const emailTarget = emailChangeTarget(ctx.path, ctx.body);
      if (!change && !emailTarget) return;
      const session = await getSessionFromCtx(ctx);
      if (!session) return; // the endpoint itself rejects the call
      const error =
        emailTarget === session.user.id
          ? "You can't change your own email. Ask another admin."
          : change && adminGuardError(session.user.id, change, await activeAdminIds());
      if (error) throw APIError.from("BAD_REQUEST", { message: error, code: "ADMIN_GUARD" });
    }),
  },
});
