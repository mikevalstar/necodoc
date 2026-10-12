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
  Items a role can't use are hidden; the pages still guard themselves.
- **Collapsing**: the sidebar collapses to an icon rail (remembered in this
  browser) and is always a rail below 1000 px. In the rail, a section's icon
  opens a menu of its pages, so every page stays reachable.
- **Top bar**: a breadcrumb (section, then page), Help (admins, to the
  [Admin FAQ](admin-faq.md)) and the notification bell.
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
  unknown paths show a not-found page inside the shell. Loading your account
  retries for about 15 seconds, so an API restart doesn't break the page; if it
  still fails, the error page offers Try again.
- **Accessibility**: a skip-to-content link, labelled icon-only buttons,
  `aria-current` on the active section and page, a visible focus ring on every
  stop, and the shell works down to tablet width (about 768 px).

## Acceptance criteria

- [x] The header fits at 820 px wide with every section reachable.
- [ ] At 820 px the sidebar is a rail and every page is reachable from it.
- [ ] Collapsing the sidebar survives a reload.
- [x] An admin named Admin sees one "Admin" in the header.
- [x] `/documents` (no such page) shows a styled not-found page with the nav.
- [x] Restarting the API while a page loads doesn't show an error page.
- [x] List and dashboard pages share one width; forms and editors use theirs.
- [x] Batch "Cancel remaining" and service account "Disable" ask for
      confirmation.

## Open questions

- No mobile (phone-width) layout for the template editors; they need the
  preview beside the editor.
