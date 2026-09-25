---
type: adr
title: Frontend stack: React SPA with TanStack Router, Query, Form and shadcn
description: The app is a client-rendered React SPA: TanStack Router for routes, Query for server state, Form for forms, shadcn for components, dayjs for dates.
tags: [architecture, frontend, app]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Frontend stack: React SPA with TanStack Router, Query, Form and shadcn

## Status

Accepted.

## Context

The product is form-heavy: users answer guided questions that end up in a
document. It sits behind a login, so server rendering buys nothing for SEO,
and the API is its own service
([ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md)).

## Decision

[apps/app](../../apps/app) is a Vite + React SPA.

- **TanStack Router** with file-based routes in `src/routes`. The generated
  `routeTree.gen.ts` is committed so `typecheck` works without a build. It's a
  plain SPA rather than TanStack Start, since there is no server rendering.
- **TanStack Query** for all server state. The query client goes through router
  context ([main.tsx](../../apps/app/src/main.tsx)).
- **TanStack Form** for forms, validated with the shared zod schemas
  ([ADR 0008](0008-zod-schemas-shared-between-api-and-app.md)).
- **shadcn/ui** on Base UI primitives (nova preset), added with the shadcn CLI
  into `src/components/ui`. Those files are vendored: edit them freely, but
  they're excluded from lint ([ADR 0009](0009-biome-for-linting-and-formatting.md)).
- **dayjs** for dates. Plugins are registered once in
  [src/lib/date.ts](../../apps/app/src/lib/date.ts); import `dayjs` from there.

## Consequences

The app deploys as static files plus the API. Anything that needs server
rendering (link previews of a document, for example) would have to come from
the API or require a move to TanStack Start.
