---
type: adr
title: Nightly demo reset rebuilds the database in place behind a resetting flag
description: "`pnpm demo:reset` raises a flag file the API answers 503 from, stops the live worker, reruns the W10 seed into the instance's own database and storage, restarts the live processes and lowers the flag. A cron job on the host runs it at midnight Toronto time."
tags: [architecture, demo, api, tooling]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T16:21:38Z }
---

# Nightly demo reset rebuilds the database in place behind a resetting flag

## Status

Accepted. Serves the [Public demo](../features/public-demo.md) and reuses the
[demo seed](../features/demo-data-and-screenshots.md). Builds on
[ADR 0044](0044-shared-demo-account-signed-in-by-a-server-only-better-auth-endpoint.md).

## Context

The public demo is shared by everyone, so it needs a clean start every night: the seeded
Harbour Surety data, no visitor leftovers, no old outputs on disk. The seed already drops and
rebuilds a database it's given, but it takes a few minutes and runs its own API and workers.
While it runs, the live processes must not touch the database (their queries fail, and a live
worker would pick up the seed's render jobs), and visitors must see a message, not errors.

Options considered:

- **Stop the live API and worker for the whole reset.** Simplest, but visitors get the proxy's
  502 for minutes and the app can't tell a reset from an outage.
- **Seed a second database and swap it in.** Short downtime, but it needs `CREATEDB` and a
  rename with no connections open, a second storage directory to swap, and twice the disk.
- **Rebuild in place behind a flag.** The live API keeps answering, but only to say it's
  resetting; the worker is stopped; both restart on the fresh data.

## Decision

- **Rebuild in place.** [reset.ts](../../scripts/demo/src/reset.ts) runs the seed against the
  instance's own `DATABASE_URL` and storage settings, read from the API's env file.
- **A flag file the API reads.** The reset creates it before anything else; while it exists,
  a `DEMO_MODE` API answers every route except health and `/api/instance` with a 503 and an
  `X-Demo-Resetting` header, before touching the database
  ([demo-reset.ts](../../apps/api/src/demo-reset.ts)). A file because the database is what's
  being rebuilt. A flag older than 30 minutes is ignored, so a killed reset can't leave the demo
  closed.
- **Pause and resume are commands, not code.** The host passes the commands that stop the live
  worker and restart the API and worker (PM2 on the Beelink). The restart drops in-memory state
  (queue connections, caches) built on the old database. The repo doesn't learn about PM2.
- **Never closed, never half-seeded.** Whatever fails, the reset restarts the live processes and
  lowers the flag. If the seed fails, it empties and migrates the database instead, so the API
  starts with only the demo user, and exits non-zero.
- **Cron, not a systemd timer.** The Beelink's other sites run scheduled jobs from cronie, a
  user timer would also need lingering turned on, and `flock` covers the one thing a timer adds
  (no overlapping runs). `CRON_TZ=America/Toronto` keeps it on Toronto midnight whatever the
  host's zone. The job and its wrapper are in [deploy/beelink](../../deploy/beelink).
- **The schedule is configuration.** `DEMO_RESET_TIME` and `DEMO_RESET_TZ` tell the API when
  the next reset is, for the banner's countdown; the cron line must say the same.

## Consequences

- Visitors see "The demo is resetting" for a few minutes a night, and the app reloads by itself.
- The reset runs only with `DEMO_MODE=true` in its environment, and the seed only accepts the
  database in `apps/api/.env` when that file turns on `DEMO_MODE`. A dev database is never a
  target.
- The cron line and `DEMO_RESET_TIME` can drift apart; the countdown is only as right as both.
- Code deploys stay manual; only the reset is automatic.
