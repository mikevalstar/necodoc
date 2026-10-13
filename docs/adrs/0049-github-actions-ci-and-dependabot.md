---
type: adr
title: GitHub Actions CI and Dependabot
description: Every push to main and every pull request runs lint, typecheck, the full test suite with the pinned Chromium, the build, migration and generated-code drift checks, the four image builds and a Helm install on kind, on GitHub Actions. Dependabot proposes grouped weekly updates; CodeQL and dependency review cover security.
tags: [architecture, deployment, security]
status: stable
generated: { by: okq/0.9.1, at: 2026-10-13T22:32:42Z }
---

# GitHub Actions CI and Dependabot

## Status

Accepted. Gates the packaging of
[ADR 0025](0025-container-images-compose-and-helm-for-self-hosting.md) and the
generated SDKs of
[ADR 0041](0041-python-net-and-java-sdks-generated-with-openapi-generator.md).

## Context

Nothing ran automatically on push. The render, PDF/A and signing tests only
pass where the exact Chromium revision `playwright-core` pins is installed, so
they were easy to skip without noticing. Generated code is committed (Drizzle
migrations, the OpenAPI document, four SDKs) and can drift from its source.
The Helm chart had never been installed on a cluster. The repository is
public, so GitHub-hosted runners cost nothing.

## Decision

- **[ci.yml](../../.github/workflows/ci.yml)**: Biome, typecheck and
  `pnpm docs:check` (okq from its GitHub release); `pnpm test` after
  `playwright-core install --with-deps --only-shell chromium`, the same
  install the api image does; `pnpm build`; committed migrations applied to an
  empty Postgres 18, then `pnpm db:generate` must produce nothing; `pnpm
  sdk:generate` must leave the tree unchanged.
- **[containers.yml](../../.github/workflows/containers.yml)**: builds the
  api, app, site and docs targets without pushing; `helm lint` and `helm
  template` across storage drivers; installs the chart on kind with the built
  images and an in-cluster Postgres, then checks readiness (database, queue,
  storage, a worker online), a Chromium print inside the worker pod under the
  chart's pod security, and the app's `/api` proxy.
- **[Dependabot](../../.github/dependabot.yml)**: npm, GitHub Actions and
  Docker base images, weekly, grouped (minor and patch together, Remotion
  together), with a cooldown so new releases age past pnpm's
  `minimumReleaseAge` first.
- **Security**: [CodeQL](../../.github/workflows/codeql.yml) for
  TypeScript and the workflows, and
  [dependency review](../../.github/workflows/dependency-review.yml) on pull
  requests, failing on high-severity advisories.
- Third-party actions are pinned to commit SHAs; Dependabot keeps them current.

Publishing images, the chart and SDKs on release, and nightly PDF/A
conformance checks with veraPDF, are left for later.

## Consequences

- Render and conformance regressions show up on every push, not only on a
  machine that happens to have the right Chromium.
- Changing `src/db/schema.ts` or an `/api/v1` route without committing the
  regenerated migration or SDKs fails CI.
- Dependabot can propose a lockfile whose transitive packages are still
  younger than `minimumReleaseAge`; its install then fails until they age, and
  a re-run the next day clears it.
- The kind job proves the chart installs and the worker image can print, but
  not a full authenticated render through the API.
