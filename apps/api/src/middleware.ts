import { randomUUID } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { zValidator } from "@hono/zod-validator";
import { hasPermission, type Permissions, parseRoles, type Role } from "@necodoc/shared";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { forwardedClient } from "./addresses";
import type { auth } from "./auth";
import { demoGuards } from "./demo";
import { env } from "./env";

export type AppEnv = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
    /** The caller's X-Request-Id, or one made up for this request; echoed on the response. */
    requestId: string;
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

/** Allows signed-in users granted at least one of the permission sets. */
export const requireAnyPermission = (...options: Permissions[]) =>
  requireRoles((roles) => options.some((permissions) => hasPermission(roles, permissions)));

export const isAdmin = (actor: { role?: string | null }) =>
  parseRoles(actor.role).includes("admin");

/** Drafts are for editors, reviewers and publishers (docs/features/document-templates.md). */
const draftAccess: Permissions[] = [
  { document: ["edit"] },
  { document: ["review"] },
  { document: ["publish"] },
];
export const seesDrafts = (actor: { role?: string | null }) =>
  draftAccess.some((permissions) => hasPermission(parseRoles(actor.role), permissions));

export const canView = requirePermission({ document: ["view"] });
export const canEdit = requirePermission({ document: ["edit"] });
export const canPublish = requirePermission({ document: ["publish"] });
export const canSeeDrafts = requireAnyPermission(...draftAccess);

/** A uuid `:id` route param. */
export const idParam = zValidator("param", z.object({ id: z.uuid() }));
/** An `:id` route param holding a Better Auth id (users, API keys), which isn't a uuid. */
export const authIdParam = zValidator("param", z.object({ id: z.string().min(1) }));

/** Accepts a sane incoming X-Request-Id (for tracing across services) or generates one. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const id = incoming && /^[\w.:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});

/** The X-Forwarded-For client behind TRUST_PROXY proxies, else the socket's address. */
export function clientIp(c: Context) {
  return (
    forwardedClient(c.req.header("X-Forwarded-For"), env.TRUST_PROXY) ||
    getConnInfo(c).remote.address ||
    "unknown"
  );
}

/**
 * ADR 0046: the public demo's refusals and limits, keyed by clientIp. Every check passes unless
 * DEMO_MODE is on.
 */
export const demo = demoGuards(
  env.DEMO_MODE
    ? {
        rendersPerMinute: env.DEMO_RENDERS_PER_MINUTE,
        uploadsPerHour: env.DEMO_UPLOADS_PER_HOUR,
        batchesPerHour: env.DEMO_BATCHES_PER_HOUR,
        signInsPerHour: env.DEMO_SIGNINS_PER_HOUR,
        aiPerIpPerDay: env.DEMO_AI_PER_IP_PER_DAY,
        aiPerDay: env.DEMO_AI_PER_DAY,
        timeZone: env.DEMO_RESET_TZ,
      }
    : null,
  clientIp,
);
