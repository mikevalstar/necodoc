---
type: feature
title: Public demo
description: With DEMO_MODE on, every visitor is signed in to one shared demo account with no login, sees a banner saying the instance is public and may be reset, and can't sign in, register or sign out. A first cut so the app can be hosted publicly now; the hardening comes later (W11).
tags: [auth, demo, app, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T15:22:08Z }
---

# Public demo

## Summary

`DEMO_MODE=true` turns an installation into a public demo: anyone who opens the app is signed
in as a shared demo user and can explore every page without an account. A banner in the app
shell says what they type is public and may be reset.

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
- **One shared demo user**, `demo@necodocs.com`, named "Demo user", with the admin role so every
  page can be explored. The API creates it on startup and again on sign-in if it's missing,
  keyed by email, so a [demo seed](demo-data-and-screenshots.md) may create it or reset the
  database underneath a running instance.
- **No other way in.** Email/password sign-in and registration are off and SSO providers are
  ignored. `/login` and `/register` land in the app, already signed in. Sign out isn't offered:
  it would only sign the visitor straight back in.
- **Banner.** A persistent warning strip in the [app shell](app-shell-and-navigation.md):
  "Public demo: anything you enter is visible to everyone and may be reset."
- **Instance label.** `GET /api/instance` reports `demoMode`, and `INSTANCE_ENV` accepts `demo`
  as a fourth environment colour.

### First cut vs hardening

This first cut only removes the login. Everything below is W11 hardening (NECO-gvjmkzgy), and
until it lands a public demo is a shared admin account on the open internet:

- **Admin role is a known risk.** Any visitor can create and ban users, issue API keys, change
  system settings and see everything other visitors entered. Hardening narrows it (read-only or
  hidden admin pages) or gives each visitor a sandboxed account.
- **Egress off or stubbed**: webhooks, SSO, e-sign handoff, external storage.
- **AI off or capped** per visitor per day, for cost.
- **Rate limits and caps**: API key creation, upload size and scanning, sessions per address
  (every cookieless request to `/api/me` creates a session row today).
- **Scheduled reset** from the W10 seed, with no PII in it.
- The marketing site's "Try the demo" link, once the demo is live.

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

## Open questions

- Shared account or one sandboxed account per visitor? Decided in W11 hardening.
