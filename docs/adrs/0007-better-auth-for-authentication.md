---
type: adr
title: Better Auth for authentication
description: Better Auth handles sign-up, sign-in and sessions, storing its tables in our Postgres through the Drizzle adapter.
tags: [architecture, auth, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Better Auth for authentication

## Status

Accepted.

## Context

Users need accounts to own their documents. We want auth that lives in our own
database, runs inside the Hono app, and can grow (OAuth, organizations, 2FA)
through plugins rather than a rewrite.

## Decision

[Better Auth](https://better-auth.com), configured in
[auth.ts](../../apps/api/src/auth.ts) with the Drizzle adapter over our Postgres
([ADR 0006](0006-postgres-with-drizzle.md)). It starts with
email and password only.

- Its handler is mounted at `/api/auth/*`. Middleware in
  [app.ts](../../apps/api/src/app.ts) loads the session on every request and
  exposes it as `c.get("user")` / `c.get("session")`.
- The auth tables in [auth-schema.ts](../../apps/api/src/db/auth-schema.ts) are
  **generated**: run `pnpm --filter @necodoc/api auth:generate` after changing
  plugins, then `pnpm db:generate` for the migration. Don't edit that file by
  hand.
- The app uses `better-auth/react`
  ([src/lib/auth.ts](../../apps/app/src/lib/auth.ts)) against its own origin
  ([ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md)).

## Consequences

Sessions are cookies, so the app and API have to stay on one origin or be
explicitly configured for cross-site cookies. Better Auth's schema changes
arrive as regenerated tables plus a migration, just like our own changes.
