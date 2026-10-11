import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AuditAction,
  type AuditActorKind,
  auditActions,
  type GenerationFilter,
  type SignInMethod,
} from "@necodoc/shared";
import { createMiddleware } from "hono/factory";
import { db } from "./db";
import { auditEvent } from "./db/schema";
import type { Tx } from "./generate";
import { type AppEnv, clientIp } from "./middleware";

// Spec: docs/features/audit-log.md, ADR 0032. The one way entries are written. Who acted and from
// where come from the request's scope (set by `auditScope` in app.ts), so helpers and Better Auth
// hooks record without being handed the request.

type Actor = {
  kind: AuditActorKind;
  id: string | null;
  name: string | null;
  impersonatorId: string | null;
  apiKeyId: string | null;
};

type Scope = {
  requestId: string;
  ip: string;
  userAgent: string | null;
  actor: Actor;
  /** What a Better Auth before-hook read about the target, for its after-hook (auth-audit.ts). */
  before?: Record<string, unknown> | null;
};

const scopes = new AsyncLocalStorage<Scope>();
const nobody = { id: null, name: null, impersonatorId: null, apiKeyId: null };

/** Opens the request's scope. Runs after the session lookup. */
export const auditScope = createMiddleware<AppEnv>((c, next) => {
  const user = c.get("user");
  const actor: Actor = user
    ? {
        kind: "user",
        id: user.id,
        name: user.name,
        impersonatorId: c.get("session")?.impersonatedBy ?? null,
        apiKeyId: null,
      }
    : { kind: "public", ...nobody };
  const scope = {
    requestId: c.get("requestId"),
    ip: clientIp(c),
    userAgent: c.req.header("User-Agent") ?? null,
    actor,
  };
  return scopes.run(scope, next);
});

/** The API-key guard: the rest of the request acts as the key (its owner is the actor id). */
export function actAsKey(key: {
  id: string;
  owner: { id: string; name: string; serviceAccount: boolean | null };
}) {
  const scope = scopes.getStore();
  if (!scope) return;
  scope.actor = {
    kind: key.owner.serviceAccount ? "service_account" : "api_key",
    id: key.owner.id,
    name: key.owner.name,
    impersonatorId: null,
    apiKeyId: key.id,
  };
}

/** The current request's scope, if any (Better Auth hooks keep state on it). */
export const currentScope = () => scopes.getStore();

type SignIn = { method: SignInMethod; provider?: string };

/** Actions that can't be recorded without these details. */
type RequiredDetails = {
  "auth.signed_in": SignIn;
  "auth.sign_in_failed": SignIn & { email: string | null; reason: string };
  "generation.bulk_deleted": { filter: GenerationFilter; deleted: number };
  "generation.link_created": { linkId: string; expiresAt: string };
};

type Fields = Record<string, unknown>;

export type AuditEvent = {
  [A in AuditAction]: {
    action: A;
    target: { id: string | null; name?: string | null };
    /** The target before and after. Only changed fields are kept; omit one for create/delete. */
    before?: Fields | null;
    after?: Fields | null;
    /** Who acted, when it isn't the request's actor (a sign-in, SSO provisioning). */
    actor?: Partial<Actor>;
  } & (A extends keyof RequiredDetails ? { details: RequiredDetails[A] } : { details?: Fields });
}[AuditAction];

/** Never recorded: secrets, and timestamps that change on every write. */
const omitted = new Set(["secret", "token", "password", "newPassword", "currentPassword"]);
const noise = new Set(["updatedAt", "createdAt"]);

/** Plain JSON with sorted keys, so equal values compare equal however they were built. */
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

/**
 * Keeps the fields that changed, each whole (a rich-text body is stored entire). A create keeps
 * all of `after`, a delete all of `before`. Secrets never go in.
 */
export function changedFields(before: Fields | null | undefined, after: Fields | null | undefined) {
  const clean = (fields: Fields, keep: (key: string) => boolean) =>
    Object.fromEntries(
      Object.entries(fields)
        .filter(([key, value]) => !omitted.has(key) && value !== undefined && keep(key))
        .map(([key, value]) => [key, stable(value)]),
    );
  if (!before || !after) {
    return {
      before: before ? clean(before, () => true) : null,
      after: after ? clean(after, () => true) : null,
    };
  }
  const changed = (key: string) =>
    !noise.has(key) && JSON.stringify(stable(before[key])) !== JSON.stringify(stable(after[key]));
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(changed);
  if (!keys.some((key) => !omitted.has(key))) return { before: null, after: null };
  return { before: clean(before, changed), after: clean(after, changed) };
}

/** Records one entry; pass the transaction making the change so they commit together. */
export async function recordAudit(event: AuditEvent, tx: Tx | typeof db = db) {
  const scope = scopes.getStore();
  const actor: Actor = { ...(scope?.actor ?? { kind: "system", ...nobody }), ...event.actor };
  const { before, after } = changedFields(event.before, event.after);
  await tx.insert(auditEvent).values({
    actorKind: actor.kind,
    actorId: actor.id,
    actorName: actor.name,
    impersonatorId: actor.impersonatorId,
    apiKeyId: actor.apiKeyId,
    action: event.action,
    targetType: auditActions[event.action],
    targetId: event.target.id,
    targetName: event.target.name ?? null,
    before,
    after,
    details: event.details ? (stable(event.details) as Fields) : null,
    ip: scope?.ip ?? null,
    userAgent: scope?.userAgent ?? null,
    requestId: scope?.requestId ?? null,
  });
}
