import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AuditAction,
  type AuditActorKind,
  auditActions,
  type GenerationFilter,
  type SignInMethod,
} from "@necodoc/shared";
import { createMiddleware } from "hono/factory";
import { changedFields, plainFields } from "./audit-diff";
import { db } from "./db";
import { auditEvent } from "./db/schema";
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

/** Records one entry; pass the transaction making the change so they commit together. */
export async function recordAudit(event: AuditEvent, tx: Pick<typeof db, "insert"> = db) {
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
    details: event.details ? plainFields(event.details) : null,
    ip: scope?.ip ?? null,
    userAgent: scope?.userAgent ?? null,
    requestId: scope?.requestId ?? null,
  });
}
