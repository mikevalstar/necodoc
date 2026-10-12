---
type: feature
title: Public demo
description: With DEMO_MODE on, every visitor is signed in to one shared demo account with no login, sees a banner saying the instance is public and when it next resets, and can't sign in, register or sign out. Every night the instance is rebuilt from the demo seed. The hardening comes later (W11).
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

### First cut vs hardening

The login and the nightly reset are in. Everything below is W11 hardening (NECO-gvjmkzgy), and
until it lands a public demo is a shared admin account on the open internet:

- **Admin role is a known risk.** Any visitor can create and ban users, issue API keys, change
  system settings and see everything other visitors entered. Hardening narrows it (read-only or
  hidden admin pages) or gives each visitor a sandboxed account.
- **Egress off or stubbed**: webhooks, SSO, e-sign handoff, external storage.
- **AI off or capped** per visitor per day, for cost.
- **Rate limits and caps**: API key creation, upload size and scanning, sessions per address
  (every cookieless request to `/api/me` creates a session row today).

The hardening should slot in behind the same `DEMO_MODE` switch: checks in the route modules
and in [demo.ts](../../apps/api/src/demo.ts), not a separate build.

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

## Open questions

- Shared account or one sandboxed account per visitor? Decided in W11 hardening.
