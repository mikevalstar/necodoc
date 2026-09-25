---
type: adr
title: pnpm workspaces monorepo
description: One pnpm workspace holds the site, the app, the API and shared packages; workspace packages ship TypeScript source and there is no task runner.
tags: [architecture, tooling]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# pnpm workspaces monorepo

## Status

Accepted.

## Context

necodoc ships three things: a static marketing site, the document-filling app,
and the API behind it. The app and the API have to agree on payload shapes and
validation rules. Keeping them in separate repos would mean publishing a
shared package and keeping versions in step by hand.

## Decision

One pnpm workspace ([pnpm-workspace.yaml](../../pnpm-workspace.yaml)):

- `apps/web`: the marketing site ([ADR 0003](0003-astro-for-the-marketing-site.md))
- `apps/app`: the SPA ([ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md))
- `apps/api`: the API ([ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md))
- `packages/shared`: code both sides import ([ADR 0008](0008-zod-schemas-shared-between-api-and-app.md))

Workspace packages export their TypeScript source directly
([ADR 0010](0010-typescript-7.md)), with no build step.
Consumers bundle them: Vite for the app and tsdown for the API, which inlines
`@necodoc/*` ([tsdown.config.ts](../../apps/api/tsdown.config.ts)) because
Node won't run TypeScript from `node_modules`.

There is no task runner. The root [package.json](../../package.json) fans out
with `pnpm -r` and `--filter`. Node 24 is pinned in `.nvmrc` and `engines`, and
pnpm through `packageManager`.

## Consequences

Changing a shared schema breaks the typecheck of both apps in the same commit.
With no per-package builds there's nothing to cache, so Turborepo would add
little until builds get slow. Revisit it then.
