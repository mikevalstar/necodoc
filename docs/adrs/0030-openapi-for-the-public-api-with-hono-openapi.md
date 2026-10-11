---
type: adr
title: OpenAPI for the public API with hono-openapi
description: The /api/v1 OpenAPI 3.1 document is generated from the shared zod schemas by hono-openapi middleware on ordinary chained Hono routes, served at /api/v1/openapi.json, shown in the app with Scalar and in the developer docs with starlight-openapi; a TypeScript SDK is generated from it.
tags: [architecture, api, docs]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T22:24:18Z }
---

# OpenAPI for the public API with hono-openapi

## Status

Accepted. Builds on [ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md),
[ADR 0008](0008-zod-schemas-shared-between-api-and-app.md) and
[ADR 0019](0019-better-auth-api-keys-for-the-public-api.md). Feeds the
reference in [ADR 0026](0026-astro-starlight-for-the-developer-docs-site.md).
Behaviour is in [HTML to PDF API](../features/html-to-pdf-api.md).

## Context

The public API needs a machine-readable description: for the reference docs,
for the in-app docs page, and for SDK generation. Written by hand it drifts.
The request and response schemas already exist as zod schemas in
`packages/shared`, and zod 4 converts to JSON Schema itself. The app's typed
client depends on routes being chained on one Hono instance (`AppType`).

## Decision

- **[hono-openapi](https://github.com/rhinobase/hono-openapi)** (1.x).
  `describeRoute()` and its `validator()` are plain middleware on the
  `/api/v1` routes, which stay chained into `AppType`. Schemas go through
  Standard Schema, so the shared zod schemas are used as they are; `.meta({ id })`
  names a component.
- **Served at `/api/v1/openapi.json`** (OpenAPI 3.1, no key needed), built
  from the routes on first request. `pnpm --filter @necodoc/api openapi` writes
  the same document to a file for builds that have no running API.
- **In the app:** an API page renders the live document with Scalar's React
  component, so calls can be tried against the deployment.
- **In the developer docs:** the `generate` script writes the document, and
  `starlight-openapi` renders the reference from it at build time.
- **SDKs are generated, never written.** The TypeScript SDK
  (`packages/sdk-ts`) is `openapi-typescript` types plus `openapi-fetch`.
  Other languages come from the same document later.

## Alternatives considered

- **`@hono/zod-openapi`.** Mature, but routes are `createRoute` objects on an
  `OpenAPIHono` instance, a different style from every other route file.
- **Writing the document by hand,** or generating it from TypeScript types:
  drifts, or loses the validation rules zod already states.
- **Swagger UI or Redoc in the app.** Scalar has a better try-it client and a
  React component.

## Consequences

- A route that skips `describeRoute` is missing from the reference. Every
  `/api/v1` route has one by convention; review has to catch a missing one.
- hono-openapi's `validator` replaces `@hono/zod-validator` on `/api/v1` only;
  it answers bad input with the public error format, not the app's.
- The document reflects the zod schemas' input types, so defaults show as
  optional fields.
