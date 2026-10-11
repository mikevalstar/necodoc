---
type: adr
title: Append-only audit log with a request-scoped actor
description: Audit entries go to one audit_event table that a database trigger makes append-only; one typed module records them, reading who and from where out of an AsyncLocalStorage scope the request middleware sets, so Better Auth hooks and helpers deep in the call stack record without being handed the request.
tags: [architecture, api, auth, enterprise]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T23:22:21Z }
---

# Append-only audit log with a request-scoped actor

## Status

Accepted. Behaviour: [Audit log](../features/audit-log.md). Builds on
[ADR 0006](0006-postgres-with-drizzle.md),
[ADR 0007](0007-better-auth-for-authentication.md) and
[ADR 0029](0029-service-accounts-and-scoped-api-keys.md).

## Context

Every change to configuration and access has to be recorded with who did it
(a person, an admin impersonating one, an API key, the system), from where
(IP, user agent, request id) and what changed. Changes happen in our route
handlers, in helpers they call (`createKey`, `createBatch`), and inside Better
Auth (sign-in, sign-out, every admin user action), whose hooks don't see the
Hono context. Threading the request through all of them would touch every
signature for one concern.

Compliance also wants the log to be trustworthy: the app must not be able to
edit or delete it.

## Decision

- **One table, `audit_event`** ([schema.ts](../../apps/api/src/db/schema.ts)):
  actor kind, id and name (a snapshot, since users get deleted), impersonator,
  API key, action, target type, id and name, before/after of the changed
  fields, details, IP, user agent, request id, time. No foreign keys, so
  deleting a user or a theme never touches its history.
- **A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`** on the
  table. No route edits or deletes entries either.
- **A typed catalogue** in
  [packages/shared/src/audit.ts](../../packages/shared/src/audit.ts) maps each
  action to its target type; callers name the action and the target type
  follows, and actions with required details (sign-in method, bulk-delete
  filter) don't compile without them.
- **One recorder,** [apps/api/src/audit.ts](../../apps/api/src/audit.ts). A
  middleware opens an `AsyncLocalStorage` scope per request with the request
  id, IP, user agent and the signed-in actor (impersonator included); the
  API-key guard narrows it to the key. `recordAudit` reads it, so Better Auth
  hooks and helpers record without extra parameters. Outside a request the
  actor is `system`. Callers pass their transaction when there is one, so the
  entry commits with the change.
- **Diffs keep changed fields only,** each whole: an edited rich-text body is
  stored entire, before and after. Secrets (webhook secrets, tokens, passwords)
  never go in.

## Consequences

- Adding an event is one call with a catalogue entry; the list, filters and
  CSV pick it up.
- Request context is implicit. It's one scope with a fixed shape, set in one
  place ([app.ts](../../apps/api/src/app.ts)), which keeps that manageable.
- A database owner can still disable the trigger or drop the table; the log is
  tamper-resistant at the application level, not tamper-evident. Hash chaining
  or shipping entries to external storage would be a later ADR.
- Better Auth writes aren't in our transactions, so its events are recorded
  just after it succeeds.
- Entries are structured JSON per field, so PII masking (a later phase) can be
  applied per field when writing or reading.
