---
type: adr
title: Astro Starlight for the developer docs site
description: User-facing developer and operator documentation is a static Astro Starlight site in apps/devdocs; the API reference will be generated from the /api/v1 OpenAPI spec with starlight-openapi, so it can't drift.
tags: [architecture, docs, frontend]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T18:00:28Z }
---

# Astro Starlight for the developer docs site

## Status

Accepted. Hosts the operator docs from
[ADR 0025](0025-container-images-compose-and-helm-for-self-hosting.md). The
public API it documents is
[ADR 0019](0019-better-auth-api-keys-for-the-public-api.md) and the
[HTML to PDF API](../features/html-to-pdf-api.md). The reference's OpenAPI
document comes from [ADR 0030](0030-openapi-for-the-public-api-with-hono-openapi.md).

## Context

Developers integrating with necodoc and operators running it need guides,
an API reference and self-hosting instructions. This bundle (`docs/`) records
intent for the team, including unbuilt work, so it can't be the user-facing
docs. The marketing site ([ADR 0003](0003-astro-for-the-marketing-site.md))
is for buyers, not integrators. The API reference must come from the code,
or it drifts.

## Decision

- **[apps/devdocs](../../apps/devdocs)** is an
  [Astro Starlight](https://starlight.astro.build) site (0.42, Astro 7),
  built to static HTML. Same toolchain as `apps/web`: TypeScript 6 for
  `astro check` ([ADR 0010](0010-typescript-7.md)), Biome. `pnpm dev` serves
  it on port 4322.
- **Content is Markdown/MDX** under `src/content/docs`: getting started,
  self-hosting, guides. It documents shipped behaviour only; planned pages are
  marked "coming".
- **The API reference will be generated** with
  [starlight-openapi](https://github.com/HiDeoo/starlight-openapi) (0.27,
  peers on Astro 7 and Starlight 0.41+) from the `/api/v1` OpenAPI document
  once it exists. The `devdocs` `generate` script is the hook: it will fetch
  or build the spec (and SDK readmes) before `astro build`. Until then it is a
  no-op and the reference page is a placeholder.
- **Hosting is undecided.** The output is plain static files; any static host
  or the `site` image can serve it later.

## Alternatives considered

- **Pages in the marketing site.** Starlight gives search, sidebar,
  versionable content and code highlighting for free; rebuilding those in
  `apps/web` is work with no upside.
- **Docusaurus.** Mature, but React/MDX tooling different from `apps/web`'s
  Astro, and a second static-site stack to maintain.
- **Scalar or Redoc as the whole site.** Good API references, poor homes for
  guides. Scalar can still be embedded in the app for interactive calls.
- **Mintlify and other hosted docs.** Customers self-host; the docs should
  build and ship from the repo like everything else.

## Consequences

- Two Astro sites in the repo; each upgrades on its own schedule.
- Docs writers must keep guides in step with the code; the reference stays in
  step by construction once generated.
- `docs/` stays internal intent; `apps/devdocs` is user-facing. A feature
  change may need both updated.
