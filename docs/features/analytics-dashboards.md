---
type: feature
title: Analytics dashboards
description: Admin dashboards for document generation (volume, render times, errors, top templates, users and keys, batches, share-link conversion) and for auth and access (sign-ins by method and provider, failures, active and new users, roles, API key and service account use), plus a personal usage view for everyone.
tags: [product, admin, analytics]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T23:40:09Z }
---

# Analytics dashboards

## Summary

Charts and tables over the data necodoc already records: the
[generation log](generation-log.md), the [audit log](audit-log.md), share-link
submissions and the user list. Admins see everyone; every user gets a
"My usage" view of their own.

## Motivation

The logs answer "what happened to this one?"; nobody can see trends in them.
Admins need to know whether volume is growing, whether renders are getting
slower or failing more, which templates and keys carry the load, whether
people sign in through SSO or passwords, and who is actually using the
product. Users want to see what they've produced.

## Behavior

- **Data, not a metrics store.** Every number is a SQL aggregate over the
  generation log, the audit log, submissions, share links and users, at
  request time. No rollup tables while that stays fast (see acceptance).
- **Shared controls** in one row above the charts: date range (presets: last
  24 hours, 7, 30, 90 days, or custom days) and, on Documents, filters for
  source, template, user and API key. Everything on the page follows them, and
  they live in the URL so a view can be shared.
- **Buckets** follow the range: hours up to 2 days, days up to 90 days, weeks
  beyond, in the viewer's time zone.
- **Every chart has a table** (toggle) and a CSV download of that table.
  Rows link through to the [generation log](generation-log.md) or the
  [audit log](audit-log.md) with the matching filters set.
- **Documents (admin):**
  - generations over time by status, and by source
  - totals: generations, error rate, pages, bytes
  - render time p50 / p95 over time, split into queue wait and run time
    ([render queue](render-queue-batch-jobs-and-scaling.md))
  - top templates, top users, top API keys; top errors (by message)
  - batches: rows, failures and rows per minute for the largest batches in the range
  - share links: views, responses in the range and conversion
    ([share links](share-links-and-data-requests.md))
- **Auth & access (admin):**
  - sign-ins over time by method (password, OIDC, SAML, trusted header) and
    by provider ([single sign-on](single-sign-on.md))
  - failed sign-ins over time, by reason, and the top emails and IPs tried
  - active users per day, with DAU, WAU and MAU for the end of the range;
    new users per day
  - role distribution (current, not ranged)
  - API keys: requests (lifetime), last used, and generations and errors in
    the range; service accounts: generations and keys
- **My usage (everyone with a role):** my generations over time by status,
  totals, my top templates, my documents by status, and, for users who can
  edit templates, how often templates they created were generated (by anyone).
- **Definitions.**
  - *Active user*: signed in, did anything recorded in the audit log as
    themselves, or generated a document without an API key, that day.
  - *Sign-in method*: SSO sign-ins are split into OIDC and SAML by the
    provider's configured type; a provider no longer configured shows as SSO.
  - *Share-link conversion*: finished submissions over views, both lifetime
    per link. A view is a load of the public link page.

## Acceptance criteria

- [ ] Admins see Documents and Auth & access; non-admins get 403 from the admin analytics API and don't see the pages.
- [ ] Any user with a role sees My usage, scoped to their own data.
- [ ] Date range and filters apply to every chart on the page and are kept in the URL.
- [ ] Each chart has a table view and a CSV download, and links into the generation or audit log with matching filters.
- [ ] Charts read in light and dark mode, with a legend for two or more series and a tooltip on hover.
- [ ] Each endpoint answers in under a second with 100k generations and 20k sign-in events over 60 days.

## Known limitations

- API key request counts are lifetime totals from the key's policy row; per-day key use counts generations made with the key, not every call.
- Sign-ins and failures are only as old as the audit log; active users can't count people who only read pages on a day without signing in.
- Share-link views are page loads, not unique visitors, and aren't bucketed by time.
- Role distribution is today's, not historical.
- Top errors group by exact message, so messages containing ids don't group.
