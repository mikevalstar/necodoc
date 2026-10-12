---
type: adr
title: Public demo stays a shared admin with dangerous actions blocked and in-memory limits
description: "In DEMO_MODE every visitor keeps the shared admin account, but the API refuses a short list of actions that would harm the instance or hand out programmatic access (403 demo_disabled), sends no webhooks, and limits renders, uploads, batches, sign-ins and AI per client address with counters held in the API process."
tags: [architecture, demo, security, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T17:20:00Z }
---

# Public demo stays a shared admin with dangerous actions blocked and in-memory limits

## Status

Accepted. Hardens the [Public demo](../features/public-demo.md). Builds on
[ADR 0044](0044-shared-demo-account-signed-in-by-a-server-only-better-auth-endpoint.md) (the
shared sign-in) and [ADR 0045](0045-nightly-demo-reset-rebuilds-the-database-in-place-behind-a-resetting-flag.md)
(the nightly reset). Answers the spec's open question: shared account or one per visitor.

## Context

The first cut signed every visitor in as one admin on the open internet. An admin can create and
ban users, issue API keys, change system settings and point webhooks anywhere, and every render
or AI call costs the host CPU or money. The demo must still show every page, admin ones
included: that is what evaluators come for.

Options considered:

- **One sandboxed account per visitor.** Each visitor sees only their own work, but the seed
  (90 days of a team's history) would have to be copied per visitor or hidden from them, and
  most pages would be empty. More rows, more code, a worse demo.
- **A non-admin demo role.** Hides the admin pages, which are a large part of what's on show.
- **Keep the shared admin, refuse what does harm.** Everything stays visible; a short list of
  actions answers 403. The nightly reset undoes ordinary vandalism, so only actions whose damage
  outlives a page view or leaves the box need blocking.

## Decision

- **Shared admin, blocklist.** In `DEMO_MODE` the API refuses user and session management of
  the shared account and of other users, API key creation and rotation, retention changes, bulk
  log deletion and pausing the queue, with `403 { error, code: "demo_disabled" }`. The app
  disables those controls with the same reason. Per-item deletes, publishing settings and
  erasures stay on: they demo features and the reset puts the data back. The checks sit in the
  route modules and the Better Auth route ([demo.ts](../../apps/api/src/demo.ts),
  [app.ts](../../apps/api/src/app.ts)), behind the same `DEMO_MODE` switch.
- **No egress.** Webhook deliveries are recorded as `skipped` instead of sent, and saving one
  doesn't resolve its host. Renders already have no network (ADR 0012), SSO is already off, and
  storage and the timestamp authority are server configuration a visitor can't reach.
- **Limits per client address, in memory.** Token buckets per address (the same
  [rate-limit.ts](../../apps/api/src/rate-limit.ts) share links use, keyed by the address
  [clientIp](../../apps/api/src/middleware.ts) reads) for renders, uploads, batches and demo
  sign-ins, plus smaller request bodies and batches. AI has a daily cap per address and one for
  the instance. All of it lives in the API process: the demo runs one API process, the nightly
  reset restarts it (which clears the counters on schedule), and a table would add a migration
  and writes for numbers that matter for a day. A restart mid-day resets the AI allowance early;
  that is the accepted cost.

## Consequences

- Visitors see every page and most actions work; the refused ones say why.
- The public can't get an API key, so `/api/v1` is closed to them without any change to it.
- Abuse from many addresses still gets through the per-address limits; the global AI cap bounds
  the spend, the queue bounds the CPU.
- Running more than one API process would multiply the limits by the process count. The demo
  doesn't, and a customer install never turns `DEMO_MODE` on.
- New dangerous actions need adding to the list: reviews of admin features should ask whether
  the demo must refuse them.
