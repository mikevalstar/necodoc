---
type: adr
title: API key rate limit counted per hour in Postgres
description: API keys are limited to a number of requests over a running hour, counted in per-minute buckets in a Postgres table that every API node shares. Replaces the Better Auth api-key plugin's rate limiter, which ADR 0019 and ADR 0029 relied on.
tags: [architecture, api, security]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T20:11:16Z }
---

# API key rate limit counted per hour in Postgres

## Status

Accepted. Supersedes the rate-limiting part of
[ADR 0019](0019-better-auth-api-keys-for-the-public-api.md) and
[ADR 0029](0029-service-accounts-and-scoped-api-keys.md); the plugin still
hashes, stores and verifies keys.

## Context

The `@better-auth/api-key` plugin's limiter keeps one counter per key and
resets it only after a whole window passes with no requests. A caller that
keeps a steady pace (one request every 30 seconds against a one-minute window)
never sees a reset and is blocked for good once it reaches the limit. Limits
must also hold across several API nodes
([ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md)),
so an in-memory limiter like the share-link one won't do.

## Decision

- **Requests per hour, running.** Each key allows a number of requests over
  the last 60 minutes, set when the key is made (default 7,200).
- **Minute buckets in Postgres.** A row per key and minute holds that minute's
  count. Each call adds to the current minute, sums the last 60, and drops the
  key's older rows, in one statement. A refused call takes its count back, so
  retrying while limited doesn't extend the wait.
- **Retry-After** is the time until the oldest counted minute leaves the hour.
- **The plugin's limiter is off** (globally and on every key). Its
  `rateLimitMax` column still holds each key's hourly limit.
- Code: [api-key-rate-limit.ts](../../apps/api/src/api-key-rate-limit.ts),
  checked from [api-keys.ts](../../apps/api/src/api-keys.ts).

## Consequences

- Steady callers below their limit are never blocked; bursts are allowed up to
  the hourly limit.
- Every keyed call writes one small row, as the plugin's limiter did.
- The window moves a minute at a time, so a minute's requests leave it
  together.
- Keys made before this change had per-minute limits; a migration multiplied
  them by 60.
