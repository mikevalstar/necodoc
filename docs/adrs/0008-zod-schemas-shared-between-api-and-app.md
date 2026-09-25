---
type: adr
title: Zod schemas shared between API and app
description: Every payload and form shape is a zod schema in packages/shared; types are inferred from the schemas, never hand-written.
tags: [architecture, validation, shared]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Zod schemas shared between API and app

## Status

Accepted. Amended by [ADR 0011](0011-role-based-access-with-the-better-auth-admin-plugin.md): `shared` may import Better Auth's browser-safe access-control modules (`better-auth/plugins/access` and `better-auth/plugins/admin/access`).

## Context

A document-filling tool has the same rules on both sides: the form rejects a bad
date in the browser, and the API rejects it again on submit. Writing those
rules twice means they drift apart.

## Decision

[packages/shared](../../packages/shared) holds zod 4 schemas for API payloads and
form shapes. Types come from `z.infer`. The API validates with `zValidator`
([ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md)); the app
passes the same schema to TanStack Form
([ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)).

The package must stay browser-safe: no Node APIs and no imports from `apps/*`.

## Consequences

A rule changes in one place and both sides pick it up. Code that only one side
needs (DB rows, server config) stays in that app, not in `shared`.
