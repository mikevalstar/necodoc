import { ac, parseRoles, roles } from "@necodoc/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { adminChange, adminGuardError, emailChangeTarget, selfDeleteError } from "./admin-guard";
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

// Specs: docs/features/user-management-and-roles.md, docs/features/user-preferences.md
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // No email provider yet: no verification, no reset-by-email. Admins set passwords.
  emailAndPassword: { enabled: true },
  user: {
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
  ],
  databaseHooks: {
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
