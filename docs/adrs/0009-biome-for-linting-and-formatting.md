---
type: adr
title: Biome for linting and formatting
description: Biome is the single linter and formatter for the whole monorepo, run from the root.
tags: [tooling, dx]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Biome for linting and formatting

## Status

Accepted.

## Context

We want lint, format and import sorting across TS/TSX, JSON and CSS in five
packages, fast enough to run before every commit, without the ESLint + Prettier
plugin sprawl.

## Decision

[Biome](https://biomejs.dev) 2, configured once in [biome.json](../../biome.json):

- 2-space indent, double quotes, `lineWidth: 100`, recommended rules, import
  organising on, Tailwind directives enabled in the CSS parser.
- `.gitignore` drives exclusions. `files.includes` also skips generated files
  (`routeTree.gen.ts`, `drizzle/meta`) and `apps/web/public`.
- Overrides: lint is off for vendored shadcn components
  (`apps/app/src/components/ui`). Unused-import and unused-variable rules are
  off in `.astro` files, because Biome can't see template usage.

Scripts: `pnpm check` (no writes) and `pnpm fix`.

## Consequences

One tool and one config. Biome has fewer rules than ESLint. If a missing rule
starts to matter, add ESLint for that one purpose and keep Biome for the rest.
