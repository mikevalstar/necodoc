import { type AuditAction, parseRoles } from "@necodoc/shared";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentScope, recordAudit } from "./audit";
import { db } from "./db";
import { user } from "./db/schema";

// Spec: docs/features/audit-log.md, ADR 0032. What Better Auth does for us (sign-in, sign-out,
// Settings, every Admin › Users action) recorded from its hooks in auth.ts. The before-hook keeps
// the target's state on the request scope; the after-hook records once the endpoint succeeded.
// Trusted-header sign-in is recorded in routes/sso.ts, which sees why a header was refused.

/** Endpoints that change a user, and what each records. */
const userActions = {
  "/admin/create-user": "user.created",
  "/admin/update-user": "user.updated",
  "/admin/set-role": "user.role_changed",
  "/admin/ban-user": "user.banned",
  "/admin/unban-user": "user.unbanned",
  "/admin/remove-user": "user.deleted",
  "/admin/set-user-password": "user.password_set",
  "/admin/revoke-user-sessions": "user.sessions_revoked",
  "/admin/impersonate-user": "user.impersonation_started",
  "/admin/stop-impersonating": "user.impersonation_stopped",
  "/sign-up/email": "user.created",
  "/update-user": "account.updated",
  "/change-password": "account.password_changed",
  "/revoke-session": "account.sessions_revoked",
  "/revoke-sessions": "account.sessions_revoked",
  "/revoke-other-sessions": "account.sessions_revoked",
  "/delete-user": "account.deleted",
  "/sign-out": "auth.signed_out",
} as const satisfies Record<string, AuditAction>;
type UserPath = keyof typeof userActions;

const isUserPath = (path: string): path is UserPath => Object.hasOwn(userActions, path);
const isSsoCallback = (path: string) =>
  path.startsWith("/sso/callback") || path.startsWith("/sso/saml2/sp/acs");

/** The shape of the hook context we read; Better Auth's is wider. */
type HookContext = {
  path: string;
  body?: unknown;
  params?: unknown;
  context: {
    returned?: unknown;
    newSession: { user: { id: string; name: string; email: string } } | null;
  };
};

const userIdBody = z.looseObject({ userId: z.coerce.string() });
const emailBody = z.looseObject({ email: z.string() });
const returnedUser = z.looseObject({ user: z.looseObject({ id: z.string() }) });
const providerParams = z.looseObject({ providerId: z.string() });

/** What's recorded about a user: no password, no image. */
async function snapshot(id: string) {
  const [row] = await db
    .select({
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .where(eq(user.id, id));
  return row ? { ...row, role: parseRoles(row.role), banned: row.banned === true } : null;
}

/** The user an endpoint acts on, when it's known before it runs. */
function targetBefore(ctx: HookContext): string | null {
  if (!isUserPath(ctx.path)) return null;
  if (ctx.path.startsWith("/admin/") && ctx.path !== "/admin/stop-impersonating") {
    return userIdBody.safeParse(ctx.body).data?.userId ?? null;
  }
  return currentScope()?.actor.id ?? null;
}

export async function auditBefore(ctx: HookContext) {
  const scope = currentScope();
  const id = targetBefore(ctx);
  if (scope && id) scope.before = { id, ...(await snapshot(id)) };
}

function failureReason(returned: APIError) {
  const code = returned.body?.code;
  if (typeof code === "string") return code;
  // SSO failures redirect to the login page with ?error=.
  const location = new Headers(returned.headers).get("location");
  const error = location ? new URL(location, "http://x").searchParams.get("error") : null;
  return error ?? returned.message ?? "unknown";
}

async function recordSignIn(ctx: HookContext, method: "password" | "sso") {
  const provider = method === "sso" ? providerParams.safeParse(ctx.params).data?.providerId : "";
  const via = { method, ...(provider ? { provider } : {}) };
  const signedIn = ctx.context.newSession?.user;
  if (signedIn) {
    await recordAudit({
      action: "auth.signed_in",
      target: { id: signedIn.id, name: signedIn.email },
      actor: { kind: "user", id: signedIn.id, name: signedIn.name },
      details: via,
    });
    return;
  }
  const { returned } = ctx.context;
  if (!(returned instanceof APIError)) return;
  const email = emailBody.safeParse(ctx.body).data?.email.toLowerCase() ?? null;
  const [known] = email
    ? await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    : [];
  await recordAudit({
    action: "auth.sign_in_failed",
    target: { id: known?.id ?? null, name: email },
    details: { ...via, email, reason: failureReason(returned) },
  });
}

export async function auditAfter(ctx: HookContext) {
  if (ctx.path === "/sign-in/email") return recordSignIn(ctx, "password");
  if (isSsoCallback(ctx.path)) return recordSignIn(ctx, "sso");
  if (!isUserPath(ctx.path) || ctx.context.returned instanceof APIError) return;

  const action = userActions[ctx.path];
  const before = currentScope()?.before ?? null;
  const created = returnedUser.safeParse(ctx.context.returned).data?.user.id;
  const id = typeof before?.id === "string" ? before.id : created;
  if (!id) return;
  const after = action.endsWith(".deleted") ? null : await snapshot(id);
  const { id: _, ...beforeFields } = before ?? {};
  const name = (after ?? beforeFields).email;
  await recordAudit({
    action,
    target: { id, name: typeof name === "string" ? name : null },
    // Creates show the new user; password and session changes have nothing to diff.
    before: before && !action.endsWith(".created") ? beforeFields : null,
    after,
    ...(ctx.path === "/sign-up/email"
      ? { actor: { kind: "user", id, name: after?.name ?? null } }
      : {}),
  });
}
