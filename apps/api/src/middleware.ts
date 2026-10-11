import { hasPermission, type Permissions, parseRoles, type Role } from "@necodoc/shared";
import { createMiddleware } from "hono/factory";
import type { auth } from "./auth";

export type AppEnv = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
};

type Defined<T> = { [K in keyof T]: NonNullable<T[K]> };
/** What handlers behind a role guard see: a signed-in user and session. */
export type SignedInEnv = { Variables: Defined<AppEnv["Variables"]> };

function requireRoles(allowed: (roles: Role[]) => boolean) {
  return createMiddleware<SignedInEnv>(async (c, next) => {
    // Typed for the handlers after this guard; here the user may still be missing.
    const user: AppEnv["Variables"]["user"] = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (!allowed(parseRoles(user.role))) return c.json({ error: "Forbidden" }, 403);
    await next();
  });
}

/** Allows signed-in users holding at least one of `accepted`. */
export const requireRole = (...accepted: Role[]) =>
  requireRoles((roles) => roles.some((role) => accepted.includes(role)));

/** Allows signed-in users whose roles, combined, grant every requested action. */
export const requirePermission = (permissions: Permissions) =>
  requireRoles((roles) => hasPermission(roles, permissions));
