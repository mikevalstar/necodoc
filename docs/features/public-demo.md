---
type: feature
title: Public demo
description: With DEMO_MODE on, every visitor is signed in to one shared demo account with no login, sees a banner saying the instance is public and when it next resets, and can't sign in, register or sign out. Every night the instance is rebuilt from the demo seed. Actions that could harm the instance, cost money or reach outside are refused or rate limited.
tags: [auth, demo, app, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T15:22:08Z }
---

# Public demo

## Summary

`DEMO_MODE=true` turns an installation into a public demo: anyone who opens the app is signed
in as a shared demo user and can explore every page without an account. A banner in the app
shell says what they type is public and counts down to the nightly reset, when the instance is
rebuilt from the [demo seed](demo-data-and-screenshots.md).

## Motivation

People evaluating necodoc from the [marketing site](marketing-site.md) want to click through
the real product, not a video. Asking them to register first, or handing out a shared password,
loses most of them. The demo should run the same build as every customer install, so it's a
mode, not a fork.

## Behavior

- **Off by default.** `DEMO_MODE` is read in [env.ts](../../apps/api/src/env.ts); unset or
  `false` changes nothing.
- **Signed in on arrival.** A visitor without a session who loads the app gets a session for
  the demo user from `GET /api/me`, which sets the session cookie and answers as that user
  ([ADR 0044](../adrs/0044-shared-demo-account-signed-in-by-a-server-only-better-auth-endpoint.md),
  [demo.ts](../../apps/api/src/demo.ts)). No password exists for the account and none is shown.
- **One shared demo user**, `demo@necodoc.com`, named "Demo user", with the admin role so every
  page can be explored. The API creates it on startup and again on sign-in if it's missing,
  keyed by email, so a [demo seed](demo-data-and-screenshots.md) may create it or reset the
  database underneath a running instance.
- **No other way in.** Email/password sign-in and registration are off and SSO providers are
  ignored. `/login` and `/register` land in the app, already signed in. Sign out isn't offered:
  it would only sign the visitor straight back in.
- **Banner.** A persistent warning strip in the [app shell](app-shell-and-navigation.md):
  "Public demo. Anything you enter is visible to everyone. Resets at midnight ET (in 3h 12m)."
  The countdown moves by the minute. The time and zone come from the server, so a visitor in
  another zone sees the right count; without a reset schedule it says "may be reset" instead.
- **Instance label.** `GET /api/instance` reports `demoMode`, and `INSTANCE_ENV` accepts `demo`
  as a fourth environment colour. With `DEMO_RESET_TIME` set it also reports `nextResetAt` (the
  next reset as an ISO instant, in `DEMO_RESET_TZ`, default `America/Toronto`) and its zone, and
  `resetting` while a reset runs.

### Nightly reset

- **`pnpm demo:reset`** rebuilds a running demo from the [demo seed](demo-data-and-screenshots.md)
  ([reset.ts](../../scripts/demo/src/reset.ts),
  [ADR 0045](../adrs/0045-nightly-demo-reset-rebuilds-the-database-in-place-behind-a-resetting-flag.md)).
  It reads the instance's env file, so it targets the demo's own database and storage, and it
  refuses to run unless that env turns on `DEMO_MODE`.
- **In order:** raise the resetting flag, stop the live worker, empty the storage directory
  (outputs; thumbnails live in the database), drop, migrate and seed the database, restart the
  live API and worker, lower the flag. Logs go to stdout.
- **The seed includes** everything the site and reel show, among it the Oregon Contractor License
  Bond with its co-principal section and the Oregon CCB overlay bond. The reset checks the
  Oregon bond is there after seeding.
- **Never left down.** If the seed fails, the reset empties and migrates the database instead,
  logs it loudly and exits non-zero; the restarted API creates the demo user, so visitors get an
  empty but working demo. The flag is lowered and the processes restarted whatever happened.
- **Visitors see a resetting page.** While the flag is up the API answers with a 503 saying the
  demo is resetting. The app swaps the page for "The demo is resetting", checks again every few
  seconds, and reloads once the demo is back, signed in afresh.
- **Automatic, at midnight Toronto time**, from a cron job on the host
  ([deploy/beelink](../../deploy/beelink)). Code deploys stay manual.
- **Linked from the site.** The [marketing site](marketing-site.md) offers "Try the demo" and
  says it's shared and resets nightly.

### Hardening

Visitors stay on the shared admin account so every page can be explored, admin ones included
([ADR 0046](../adrs/0046-public-demo-stays-a-shared-admin-with-dangerous-actions-blocked-and-in-memory-limits.md)).
What could harm the instance for everyone, cost money or reach outside is refused instead. All
of it is gated on `DEMO_MODE`; other installations behave as before.

- **Refused actions.** The API answers `403 { error, code: "demo_disabled" }`, and the app shows
  the control disabled with "Turned off in the public demo" as its tooltip
  ([demo-lock.tsx](../../apps/app/src/components/demo-lock.tsx)):
  - creating, editing, banning, deleting users, setting roles or passwords, revoking anyone's
    sessions (Admin › Users); the shared account's own profile, password, sessions and deletion
    (Settings). Impersonating a seeded user stays on.
  - creating and rotating API keys, for people and service accounts: the public must not get
    programmatic rendering. Revoking stays on. The in-app Render page and editor previews work.
  - retention settings and "Run now", bulk deletion of the generation log, pausing a queue:
    each would empty or stop the demo for everyone until the reset.
  - Still on, because the reset undoes them: deleting single items, erasure requests, publishing
    settings, cancelling and retrying jobs.
- **No egress.** Webhooks can be created and tested, but deliveries are recorded as **skipped**
  ("Not sent in the public demo") and saving one doesn't resolve its host.
  SSO is off. Storage, the timestamp authority and e-sign are server configuration or JSON
  built on read, with nothing a visitor can point elsewhere. Renders have no network anyway.
- **AI** is off unless `ANTHROPIC_KEY` is set. When it is, each AI request (assistant turn,
  description, version note, field detection) counts against a daily allowance per client
  address (`DEMO_AI_PER_IP_PER_DAY`, 20) and for the whole demo (`DEMO_AI_PER_DAY`, 300), days in
  `DEMO_RESET_TZ`. Over either, the API answers 429 saying so.
- **Rate limits per client address** (from `X-Forwarded-For` with `TRUST_PROXY`), as 429 with
  `Retry-After`: renders, previews, test runs, re-runs and submission PDFs
  (`DEMO_RENDERS_PER_MINUTE`, 30); asset and PDF uploads (`DEMO_UPLOADS_PER_HOUR`, 30); batches
  (`DEMO_BATCHES_PER_HOUR`, 10). Each is a burst of that many, refilled evenly.
- **Smaller inputs.** Request bodies, uploads included, are capped at `DEMO_UPLOAD_MAX_MB` (5),
  and a batch at `DEMO_BATCH_MAX_ROWS` rows (25).
- **Sign-ins per address.** `GET /api/me` creates at most `DEMO_SIGNINS_PER_HOUR` (30) demo
  sessions per client address; past that it answers 429, so a script looping on it can't fill
  the session table. The reset wipes sessions nightly.
- **Counters live in the API process** and start again when it restarts, which the nightly
  reset does.
- **No real people in the seed.** Harbour Surety's staff and clients are fictional, on
  `.example` addresses and private office IPs ([people.ts](../../scripts/demo/src/people.ts)).

### Limitations

- Anything a visitor enters is visible to every other visitor until the reset.
- Visitors can still delete or edit seeded templates, themes and documents one at a time.
- Limits are per address: many addresses get many allowances. The global AI cap bounds spend.
- Uploads are size-limited, not virus-scanned. They're parsed as PDFs, images or fonts and never
  served to other sites.
- Restarting the API mid-day resets the AI allowance and rate limits early.

## Acceptance criteria

- [ ] With `DEMO_MODE` unset, sign-in, registration, SSO and sign out behave as before.
- [ ] With `DEMO_MODE=true`, a fresh browser opening the app lands signed in as the demo user,
      with the banner showing.
- [ ] `/login` and `/register` redirect into the app; password sign-in and sign-up endpoints
      refuse; no SSO buttons show.
- [ ] The demo user is created once, keyed by email, and reused across restarts and seeds.
- [ ] The session endpoint can't be called over HTTP; only the API itself creates demo sessions.
- [ ] `INSTANCE_ENV=demo` shows its own colour.
- [ ] With `DEMO_RESET_TIME=00:00`, the banner counts down to the next Toronto midnight, also
      across daylight saving changes and in a browser set to another zone.
- [ ] `pnpm demo:reset` against a running demo shows visitors the resetting page, then the
      freshly seeded data (the Oregon Contractor License Bond among it) without a manual reload.
- [ ] A failed seed leaves the demo running on an empty, migrated database with the demo user,
      and the reset exits non-zero.
- [ ] `pnpm demo:reset` refuses an environment without `DEMO_MODE=true`.
- [ ] In the demo, Admin › Users changes, API key creation and rotation, retention, bulk log
      deletion and queue pause answer 403 `demo_disabled`, and their controls show disabled with
      the reason.
- [ ] A webhook test in the demo shows a skipped delivery; nothing is sent.
- [ ] Past the render, upload, batch or sign-in limit an address gets 429 with `Retry-After`.
- [ ] With AI on, past either daily AI cap the API answers 429 with a message saying so.
- [ ] Without `DEMO_MODE` none of these limits or refusals apply.

## Open questions

- None. Shared account or one per visitor was settled by ADR 0046: shared.
