---
type: feature
title: Demo data and screenshots
description: A re-runnable seed (`pnpm demo:seed`) that builds a realistic, PII-free surety carrier instance in its own database, and a script (`pnpm demo:screens`) that recaptures every screenshot the marketing site and the product tour reel use from it, so no image is ever staged or hand-edited.
tags: [marketing, web, demo, tooling]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T14:44:20Z }
---

# Demo data and screenshots

## Summary

`pnpm demo:seed` resets a separate database and fills it with a fictional surety carrier,
Harbour Surety: people with roles, templates with version history, reviews, tests, share links,
API keys, webhooks and 90 days of generations. `pnpm demo:screens` reseeds, starts that instance
on unused ports and captures every screenshot the [marketing site](marketing-site.md) and the
[product tour reel](product-tour-reel.md) use, at their existing names and sizes.

## Motivation

The first site and reel screenshots came from the dev database: test template names, 8-20%
error rates from agent testing, empty review and test tabs. They were staged in the browser
before capture (renamed rows, a removed outlier, replaced hostnames and storage paths). Staged
images drift from the product and can't be retaken per release. A seeded instance gives every
screen something real to show, and a script makes the images reproducible.

## Behavior

### Where it runs

- **Never the dev database.** By default the seed uses a private Postgres cluster in `.demo/`
  at the repo root (gitignored), started from the binaries `pg_config` names, the way the
  [benchmark](performance-benchmark.md) does ([stack.ts](../../scripts/bench/src/stack.ts)). It
  starts its own `ROLE=api` and `ROLE=worker` processes on unused ports, and stops them and the
  cluster when it's done, also when it fails.
- **Or a given database.** `DEMO_DATABASE_URL` points it at another database instead (the
  future public demo). It refuses the URL in `apps/api/.env`.
- **Reset, then seed.** Every run drops and recreates the database (or, with
  `DEMO_DATABASE_URL`, its schemas) and empties the private cluster's output directory, migrates,
  and seeds from nothing. One entry point, [seed.ts](../../scripts/demo/src/seed.ts), so a
  nightly reset (W13's `pnpm demo:reset`) can run it against any database and storage: with
  `DEMO_DATABASE_URL` set, the `STORAGE_*`, `S3_*` and `AZURE_*` settings in the environment are
  passed to the API and workers it starts.
- **Process names.** API and worker processes report pod-style hostnames
  (`necodoc-worker-…`), outputs go to the disk driver under `/var/tmp/necodoc-demo/outputs` (a
  link into `.demo/`), and the version is the git commit, so no screenshot shows the machine it
  was taken on.

### What's seeded

All of it is fictional: people, companies, addresses and emails use `.example` domains. No real
personal data.

- **People:** an admin, two publishers, a reviewer, an editor and four fillers (viewers), plus
  a pending sign-up. Four service accounts own the integration keys
  ([users and roles](user-management-and-roles.md)). Everyone's password is
  `harbour-demo-2026`; the demo's own sign-in is `demo@necodoc.com` (an admin for now; W11
  decides what a public visitor gets).
- **Look:** a Harbour Surety theme and logo ([themes](document-themes.md), [assets](assets.md)),
  and clause snippets ([snippet library](snippet-library.md)).
- **Designed templates:** Oregon contractor licence bond (conditional co-principal), Ontario
  certificate of surety bond, certificate of insurance, commercial policy declarations in English
  with a fr-CA translation ([localization](document-localization.md)), claims acknowledgement
  letter and renewal notice.
- **Overlay templates** on the [surety bond fixtures](../../fixtures/pdfs/surety-bonds/README.md):
  Oregon CCB, Castle Pines, New Haven and NY DMV VS-3, with signers
  ([overlay templates](pdf-overlay-templates.md), [signing packages](signing-packages.md)).
  The bond templates (the Oregon licence bond with its "Add a co-principal" section, the
  Ontario certificate and the overlays) are the ones the site and reel show, kept as JSON in
  [templates/](../../scripts/demo/src/templates); the others are built in
  [designed.ts](../../scripts/demo/src/designed.ts).
- **Change control:** several published versions with notes per template, review required for
  publishing, a review that went through changes requested to approved and published, an
  approved review not yet published, an open one with comments
  ([review and approval](review-and-approval.md)), and test cases on the bond templates
  ([test cases](template-test-cases-and-visual-diff.md)).
- **Integrations:** API keys with scopes (one rotated, one revoked, one expiring soon), webhooks
  to `.example` hosts, all disabled ([webhooks](webhooks.md)), shared and personal saved views
  ([saved views](saved-views.md)). The webhooks are inserted with the audit entry the API would
  write, because creating one through the API resolves its host and `.example` hosts resolve
  nowhere. AI shows as configured (a placeholder key) so its buttons are in the screenshots;
  nothing calls it.
- **Filling:** documents in progress and finished, share links with responses and view counts
  ([share links](share-links-and-data-requests.md)).
- **History:** about 3,600 generations over 90 days with weekday and business-hour traffic, two
  batches, about 0.5% failures, and retention of 14 days for outputs and 30 for inputs
  ([generation log](generation-log.md)). The [audit log](audit-log.md) holds the story's sign-ins
  and changes in order.

### How the history is made

- **Through the product first.** Setup, templates, publishing, reviews, keys and webhooks go
  through the app's API as the person who'd do them, with their own office IP and browser, so
  audit entries and diffs are real. Each step of the story is then moved back to its day in the
  story by shifting the timestamps it wrote; the seed lifts the audit log's append-only trigger
  only for that, on its own database.
- **Real renders for the last 14 days.** Every generation inside the output retention window
  (API calls with keys, documents finished in the app, share-link responses and the batches) is
  rendered by the worker, so its PDF, timings and signing package exist. Their times are then
  spread over those days.
- **Direct inserts for older history and failures.** Generations from 14 to 90 days ago are
  inserted into the log as retention would have left them: no output, and no input past 30
  days. Their render times are drawn from the [benchmark](performance-benchmark.md) results'
  distributions for the same kind of document. Failures (about 0.5%, with real error messages)
  are inserted too, since a healthy instance doesn't fail on demand.

### Screenshots

- **One manifest.** [shots.ts](../../scripts/demo/src/shots.ts) lists every image: its route,
  what to do before capture (open a dialog, type in the palette, tick a box, scroll), the
  viewport, and the target file. Website images go to
  [apps/web/src/assets/screens](../../apps/web/src/assets/screens) (PNG, 2x), reel images to
  [apps/reel/public/screens](../../apps/reel/public/screens) (JPEG, 2400 px wide), at the
  sizes and crops the pages and scenes already expect.
- **Deterministic capture.** Playwright drives full Chromium in headless mode (it has the PDF
  viewer the previews use): fixed viewport, light theme, comfortable density, expanded sidebar,
  Toronto time zone, reduced motion, hidden scrollbars and carets, animations off. The data is
  seeded with a fixed random seed, and the capture follows the seed by a minute, so relative
  times ("2 hours ago") come out the same.
- **Run.** `pnpm demo:screens` reseeds unless told not to, starts the API, a worker and the app
  (Vite) on unused ports, signs in as the admin, captures, and stops everything.
  `--only <name>` retakes some images; `--serve` starts the instance and waits, for looking
  around.
- **After a UI change:** run `pnpm demo:screens`, then re-render the reel
  (`pnpm --filter @necodoc/reel render`) and rebuild the site.

### Reuse for the public demo (W11)

The public no-login demo will run this seed against its own database with `DEMO_DATABASE_URL`
on a schedule; the reset makes each run start clean. Its security model (the auto sign-in,
outbound calls off, AI limits) is W11's spec and ADR, not this seed's. The seed keeps webhooks
disabled and on `.example` hosts and holds no secrets worth stealing, so nothing it creates
reaches outside the instance.

## Acceptance criteria

- [ ] `pnpm demo:seed` builds the instance from nothing in a few minutes and gives the same
      result on a second run; it never connects to the dev database.
- [ ] Every screenshot the site and the reel import comes from `pnpm demo:screens`, with
      nothing edited after capture.
- [ ] The generation log shows about 0.5% failures and render times in line with the
      benchmark; the System, Queue, Audit, Reviews and Tests screens all have content.
- [ ] Recent generations open with their PDF; older ones show what retention removed.
- [ ] No real names, emails, hostnames or local paths appear in any screenshot.

## Open questions

- Absolute dates in screenshots follow the day they were taken. The browser clock isn't
  pinned: documents finished during the capture get the server's time, and a pinned clock
  would show them "in a few seconds". Pinning dates would mean faking the database clock too.
- The volume (about 40 documents a working day) makes Admin › System's renders per minute
  small; its shot uses the last 7 days so the figures cover working days and a batch.
- The API reference shows the Vite port it was captured on (`http://localhost:…/api/v1`).
