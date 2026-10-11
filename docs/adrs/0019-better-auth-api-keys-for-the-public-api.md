---
type: adr
title: Better Auth API keys for the public API
description: The public API lives under /api/v1, authenticates with per-user keys from the @better-auth/api-key plugin sent in x-api-key, and answers synchronously with PDF bytes or JSON with a generation id.
tags: [architecture, api, auth]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Better Auth API keys for the public API

## Status

Accepted. Extends [ADR 0007](0007-better-auth-for-authentication.md) and
[ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md). Behaviour is
in [HTML to PDF API](../features/html-to-pdf-api.md). Extended by
[ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md):
calls can also run async or past a wait timeout (`202` with a generation id).

## Context

Developers call necodoc from their own servers: render HTML, generate from a
template, combine PDFs. Session cookies don't suit server-to-server calls.
Keys need to be revocable, rate-limited, and tied to a person so the
[generation log](../features/generation-log.md) can say who did what.

## Decision

- Use Better Auth's **API key plugin**, the `@better-auth/api-key` package
  (`apiKey()` on the server, `apiKeyClient()` in the app). Its tables are
  generated like the other auth tables.
- **Keys belong to a user.** A request made with a key has exactly that user's
  [roles](../features/user-management-and-roles.md); a key can't grant more.
  Banned or role-less users' keys stop working.
- Keys travel in the `x-api-key` header. Middleware on `/api/v1` verifies the
  key with the plugin and loads its user. It does not turn keys into sessions
  (the plugin's `enableSessionForAPIKeys` stays off), so a leaked key can't
  reach the app's own routes.
- The plugin's rate limiting is on, per key.
- **Versioned public routes** under `/api/v1`, chained on the same Hono app so
  the RPC types still hold. The app's own routes stay unversioned under `/api`.
  A breaking change means `/api/v2`.
- **Synchronous responses.** A render returns when the PDF is ready.
  `Accept: application/pdf` gets the bytes; `Accept: application/json` gets the
  generation id, page count, size and a download path.
- Request and response bodies are zod schemas in `packages/shared`
  ([ADR 0008](0008-zod-schemas-shared-between-api-and-app.md)); the API docs
  page is generated from them.

## Consequences

- Callers wait for the render. Big documents hit the render timeout
  ([ADR 0012](0012-headless-chromium-for-html-to-pdf.md)) instead of queuing.
  Async jobs and batch generation need a new ADR.
- Keys inherit role changes immediately, so demoting a user also restricts
  their integrations.
- The key is shown once, at creation. Lost keys are replaced, not recovered.
