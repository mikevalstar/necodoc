---
type: adr
title: Shared demo account signed in by a server-only Better Auth endpoint
description: In DEMO_MODE, GET /api/me signs a visitor without a session in to one shared demo user through a Better Auth plugin endpoint that can only be called server-side, so the session and cookie are Better Auth's own and no password exists.
tags: [architecture, auth, demo, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T15:22:08Z }
---

# Shared demo account signed in by a server-only Better Auth endpoint

## Status

Accepted. Serves the [Public demo](../features/public-demo.md). Builds on
[ADR 0007](0007-better-auth-for-authentication.md).

## Context

A public demo needs visitors signed in without a login. The options were a published password
(anyone can change it, and it invites abuse of the sign-in endpoint), a middleware that fakes a
user on every request without a session (every check that reads the session, Better Auth's own
included, would need to know about it), or a real session created for the visitor.

## Decision

- A small Better Auth plugin in [demo.ts](../../apps/api/src/demo.ts) adds one endpoint marked
  `SERVER_ONLY`: Better Auth's router never exposes it over HTTP, only `auth.api` can call it.
  It finds or creates the demo user by email, creates a session with Better Auth's internal
  adapter and sets the signed session cookie.
- `GET /api/me` ([app.ts](../../apps/api/src/app.ts)) calls it when `DEMO_MODE` is on and the
  request has no session, forwards the cookie and answers as the demo user. The app already
  loads `/api/me` before every page, so it needs no sign-in step of its own.
- One shared user with the admin role for now. Per-visitor accounts and narrower roles are
  W11 hardening.

## Consequences

- Sessions are ordinary Better Auth sessions: expiry, revocation, the service-account guard and
  every role check work unchanged.
- No password or sign-in endpoint is exposed for the demo account.
- Every visitor without a cookie creates a session row; rate limiting and cleanup are part of
  the hardening.
- Everyone shares one identity: the audit log and "my documents" can't tell visitors apart.
