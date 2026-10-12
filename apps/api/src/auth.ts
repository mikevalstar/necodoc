import { apiKey } from "@better-auth/api-key";
import { API_KEY_PREFIX, ac, roles } from "@necodoc/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import {
  adminChange,
  adminGuardError,
  emailChangeTarget,
  selfDeleteError,
  serviceAccountTarget,
} from "./admin-guard";
import { auditAfter, auditBefore } from "./auth-audit";
import { db } from "./db";
import { user } from "./db/schema";
import { demoSession } from "./demo";
import { env, passwordEnabled } from "./env";
import { ssoDisabledPaths, ssoPlugins, ssoTrustedOrigins } from "./sso";
import { activeAdminIds, isServiceAccount } from "./users";

// Specs: docs/features/user-management-and-roles.md, docs/features/user-preferences.md
export const auth = betterAuth({
  // Transactions: the SSO plugin's resolveUser runs inside one (ADR 0031).
  database: drizzleAdapter(db, { provider: "pg", transaction: true }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: ssoTrustedOrigins,
  // Failed SSO callbacks land on the login page, which shows the error.
  onAPIError: { errorURL: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/login` },
  // No email provider yet: no verification, no reset-by-email. Admins set passwords.
  // ADR 0031: off for SSO-only installs and the public demo.
  emailAndPassword: { enabled: passwordEnabled },
  // ADR 0029: keys are created and changed only through routes/api-keys.ts, which call the
  // plugin server-side; its own HTTP endpoints would bypass scopes and revocation.
  disabledPaths: [
    "/api-key/create",
    "/api-key/update",
    "/api-key/delete",
    "/api-key/get",
    "/api-key/list",
    ...ssoDisabledPaths,
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
    // ADR 0019/0029: hashing and lookup. Expiry, scopes and revocation live in api_key_policy
    // (the plugin deletes expired keys; we keep them listed). Its rate limiter is off: it never
    // resets for a steady caller, so ours counts the hour instead (ADR 0048).
    apiKey({
      defaultPrefix: API_KEY_PREFIX,
      startingCharactersConfig: { charactersLength: API_KEY_PREFIX.length + 6 },
      maximumNameLength: 100,
      rateLimit: { enabled: false },
      enableSessionForAPIKeys: false,
    }),
    ...ssoPlugins,
    // ADR 0044: server-only (never on HTTP); GET /api/me calls it in DEMO_MODE.
    demoSession(),
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
      await auditBefore(ctx);
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
    // ADR 0032: sign-ins (failed ones too), sign-out, Settings and Admin › Users actions.
    after: createAuthMiddleware(auditAfter),
  },
});
