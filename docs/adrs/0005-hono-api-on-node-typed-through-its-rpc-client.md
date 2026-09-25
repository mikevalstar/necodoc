---
type: adr
title: Hono API on Node, typed through its RPC client
description: The API is a Hono app on Node under /api; the SPA calls it through Hono's typed RPC client on the same origin.
tags: [architecture, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Hono API on Node, typed through its RPC client

## Status

Accepted. Node is the provisional deploy target (see Consequences).

## Context

The app needs typed calls to the API without keeping an OpenAPI spec or a
code generator in step. Better Auth
([ADR 0007](0007-better-auth-for-authentication.md)) uses cookies, which are
simplest when the app and API share an origin.

## Decision

[apps/api](../../apps/api) is a Hono app with every route under `/api`
([app.ts](../../apps/api/src/app.ts)), served by `@hono/node-server`
([index.ts](../../apps/api/src/index.ts)). Request bodies are validated with
`@hono/zod-validator` against the shared schemas.

`app.ts` exports `type AppType`. The app imports it as a type only
(`@necodoc/api/app`) and calls the API through `hc<AppType>`
([src/lib/api.ts](../../apps/app/src/lib/api.ts)), so route and response types
come from the server code, with no codegen.

Same origin: in dev, Vite proxies `/api` to the API
([vite.config.ts](../../apps/app/vite.config.ts)). In production, either Hono
serves the built SPA or a reverse proxy puts both on one host.

Environment variables are validated with zod at startup
([env.ts](../../apps/api/src/env.ts)).

## Consequences

The RPC types only work while routes are chained on one Hono instance. Split
routes across files with `app.route()` and keep the chain intact.

The deploy target is still open. Hono also runs on Bun, Deno and Workers, so
leaving Node later means a new entrypoint plus a Postgres driver that works
there. PDF rendering ([filling out a document](../features/filling-out-a-document.md))
may settle it.
