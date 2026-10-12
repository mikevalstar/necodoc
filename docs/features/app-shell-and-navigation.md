---
type: feature
title: App shell and navigation
description: The signed-in app's frame - navigation grouped by job, an account menu, one page layout, and the shared states (empty, loading, not found, errors, confirmations, toasts).
tags: [app, product, ux]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T07:39:47Z }
---

# App shell and navigation

## Summary

Every signed-in page shares one frame: a sidebar with the logo, navigation
grouped by what people come to do and your account, plus a top bar with where
you are, help and notifications. Pages share one
layout and the same handling for empty lists, loading, missing pages, errors,
destructive actions and feedback.

## Motivation

Enterprise users switch between filling documents, designing templates,
integrating the API and administering the system. A flat row of a dozen links
didn't fit a tablet, mixed those jobs together, and showed two buttons named
"Admin" to an admin called Admin. Pages had different widths and headers, and
an API restart replaced the page with an error.

## Behavior

- **Shell** ([_app.tsx](../../apps/app/src/routes/_app.tsx)), styled per the
  [Design system](design-system.md): a cobalt sidebar with the
  [logo](../../apps/app/src/components/logo.tsx), four sections and, under the
  current one, its pages:
  - **Documents**: My documents, Share links (publishers; shows unseen
    responses).
  - **Templates**: Templates, Reviews, Snippets, Themes, Assets.
  - **Developers**: API reference, API keys (your own), Render playground,
    Generations, Batches.
  - **Admin** (admins only): Users, Service accounts, API keys, System, Queue,
    Analytics, Audit log, Data subjects, FAQ.
  Items a role can't use are hidden; the pages still guard themselves: opening
  one anyway keeps the URL and shows "You don't have access to this"
  ([auth.ts](../../apps/app/src/lib/auth.ts) `requireAccess`).
- **Instance identity**: when the deployment sets `INSTANCE_NAME` (and
  optionally `INSTANCE_ENV`: `prod`, `staging` or `dev`), the top of the
  sidebar names the instance with its environment ("Harbour Surety · prod"),
  coloured per environment so staging is never mistaken for production. The
  rail shows the name's initials; the login page shows the same label. Every
  customer self-hosts one instance, so this is a label, not a tenant switcher
  ([env.ts](../../apps/api/src/env.ts), public `GET /api/instance`). Unset, the
  block is hidden.
- **Collapsing**: the sidebar collapses to an icon rail (remembered in this
  browser) and is always a rail below 1000 px. In the rail, a section's icon
  opens a menu of its pages, so every page stays reachable.
- **Top bar**: a breadcrumb (section, then page, then the record a detail
  page shows, e.g. "Templates › Invoice"; [breadcrumb.ts](../../apps/app/src/lib/breadcrumb.ts)),
  "Search or jump to…" (the [Command palette](command-palette.md), Ctrl+K /
  Cmd+K), Help (admins, to the [Admin FAQ](admin-faq.md)) and the
  notification bell.
- **Ops status bar** (admins, opt-in per browser in Settings › Appearance or
  from the command palette): a thin bar at the bottom of the shell with the
  API connection, queue depth, workers online and their busy/total slots, p95
  render time and failure rate over the last hour, and the API version. Each
  item opens the admin page behind it (System or Queue). It reads the same
  data as [Admin › System](render-queue-batch-jobs-and-scaling.md), polls
  every 30 seconds and pauses while the tab is hidden
  ([ops-status-bar.tsx](../../apps/app/src/components/ops-status-bar.tsx)).
  Non-admins never see it.
- **Account**: at the bottom of the sidebar, your initials and name with a
  light/dark toggle. It opens a menu with Settings, My usage and Sign out
  ([User preferences](user-preferences.md)).
- **Page frame** ([page.tsx](../../apps/app/src/components/page.tsx)): one
  header pattern (back link on detail pages, title, one line on what the page
  is for, primary action last) and three widths: narrow for forms and single
  records, default for lists and dashboards, wide for editors with a preview.
- **First run**: the home page says what to do next; see
  [Filling out a document](filling-out-a-document.md).
- **Shared states**: empty lists explain what goes there and offer the next
  step; lists show skeletons while loading; destructive or hard-to-undo
  actions ask first ([confirm-dialog.tsx](../../apps/app/src/components/confirm-dialog.tsx));
  actions without a visible result confirm with a toast.
- **Help**: admins get a Help link next to features that have an
  [Admin FAQ](admin-faq.md) entry, opening that entry.
- **Not found and errors**
  ([route-states.tsx](../../apps/app/src/components/route-states.tsx)):
  unknown paths, and records that don't exist (a bad or deleted id), show a
  not-found page inside the shell with a way back (a malformed id counts as
  not found). A 403, from the API or a page your role can't open, says you
  don't have access and to ask an admin; an expired session offers Sign in. Loading your
  account retries for about 15 seconds, so an API restart doesn't break the
  page, and a slow load says it's waiting for the server. If it still fails,
  the error page says necodoc isn't responding and offers Try again (it
  retries by itself when the browser comes back online). Before sign-in these
  screens stand alone on the cobalt frame.
- **Deep links survive sign-in**: a signed-out visitor sent to the login page
  carries the page they asked for in `?redirect=`, and signing in (password,
  registration, SSO, or leaving the pending page once granted a role) returns
  them there. Only same-origin relative paths are honoured, so the parameter
  can't send anyone to another site
  ([return-path.ts](../../packages/shared/src/return-path.ts)).
- **First paint**: the page shows the neko mark on the canvas until the app
  loads ([index.html](../../apps/app/index.html)).
- **Accessibility**: a skip-to-content link, labelled icon-only buttons,
  `aria-current` on the active section and page, a visible focus ring on every
  stop, and the shell works down to tablet width (about 768 px).

## Acceptance criteria

- [x] The header fits at 820 px wide with every section reachable.
- [ ] At 820 px the sidebar is a rail and every page is reachable from it.
- [ ] Collapsing the sidebar survives a reload.
- [x] An admin named Admin sees one "Admin" in the header.
- [x] `/documents` (no such page) shows a styled not-found page with the nav.
- [ ] A detail page with a bogus id shows not found, not "Something went wrong".
- [x] A viewer opening an admin URL sees "You don't have access to this" at
      that URL, not the home page.
- [x] Signing in from a deep link returns to it; `?redirect=//evil.example`
      or an absolute URL goes home instead.
- [ ] With the API unreachable, the page says so and Try again recovers.
- [x] Restarting the API while a page loads doesn't show an error page.
- [x] List and dashboard pages share one width; forms and editors use theirs.
- [x] Batch "Cancel remaining" and service account "Disable" ask for
      confirmation.
- [ ] With `INSTANCE_NAME=Harbour Surety` and `INSTANCE_ENV=prod`, the sidebar
      and login page read "Harbour Surety · prod"; the rail shows "HS".
- [ ] An admin who turns on the status bar sees queue depth, workers and p95;
      it stops polling while the tab is hidden; a viewer has no toggle.

## Open questions

- No mobile (phone-width) layout for the template editors; they need the
  preview beside the editor.
