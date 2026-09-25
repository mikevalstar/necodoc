---
type: adr
title: TypeScript 7
description: TypeScript 7 (the native compiler) everywhere except the Astro site, which stays on TS 6 until astro check supports 7.
tags: [tooling, dx]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# TypeScript 7

## Status

Accepted.

## Context

TypeScript 7, the Go-native compiler, is the current release and typechecks
several times faster than 6. Some tools still depend on the TS 6 JavaScript
API, including `@astrojs/check`, which declares `typescript ^5 || ^6`.

## Decision

- `apps/app`, `apps/api` and `packages/shared` use TypeScript 7 and extend
  [tsconfig.base.json](../../tsconfig.base.json): `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, bundler resolution,
  `noEmit`.
- `apps/web` uses TypeScript 6 for `astro check`.
- Not enabled: `exactOptionalPropertyTypes`. It clashes with the optional
  props (`className?: string`) all through the shadcn components.
- TS 7 has no `baseUrl`. Path aliases (`@/*` in the app) resolve relative to
  their tsconfig, and each package lists its `types` explicitly.

## Consequences

Typechecks stay fast. Two TypeScript majors live in the lockfile until Astro
catches up; move `apps/web` to 7 once it does.
