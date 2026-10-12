---
type: feature
title: Saved views
description: Users save a big table's filters, sort and columns under a name and reopen it from the table toolbar; admins can share a view with everyone.
tags: [product, app, admin]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T12:47:12Z }
---

# Saved views

## Summary

A saved view is a named copy of a table's URL state: its filters, sort,
page size and visible columns. Pick it from the table's toolbar to get the
same view back.

## Motivation

The [generation log](generation-log.md) and [audit log](audit-log.md) run
to tens of thousands of rows, and the questions people ask of them repeat:
"failed API renders this week", "slow batch rows", "role changes". Their
state already lives in the URL, so a bookmark works, but bookmarks are
per-browser and can't be handed to a team.

## Behavior

- **Tables**: the generation log and the audit log, both on the shared data
  table ([ADR 0021](../adrs/0021-tanstack-table-for-server-side-data-tables.md)).
  A view belongs to one table.
- **What's saved** is the URL search of the table, minus the page number and
  any open drawer. Opening a view replaces the current filters with it. The
  menu marks the view matching the current URL.
- **Save view** in the table toolbar names the current state. Names are
  unique per owner and table.
- **Per user**: views are private to whoever saved them. Admins can mark a
  view **shared**; shared views show for everyone who can open that table,
  under their own heading.
- **Rename, update and delete**: owners manage their own views (update
  stores the current state into the view). Admins can manage every shared
  view. Non-admins can't share or change a shared view.
- Creating, changing or deleting a shared view (or sharing / unsharing one)
  is recorded in the [audit log](audit-log.md). Private views aren't.
- Stored server-side ([saved-views route](../../apps/api/src/routes/saved-views.ts),
  schemas in [packages/shared/src/saved-view.ts](../../packages/shared/src/saved-view.ts)),
  so they follow the user between browsers.
- The menu is [components/saved-views.tsx](../../apps/app/src/components/saved-views.tsx);
  it also exports a compact list for the sidebar.

## Acceptance criteria

- [ ] A user saves the generation log's current filters, sort and columns and
      gets them back from the toolbar in another browser.
- [ ] A view can be renamed, updated to the current state and deleted.
- [ ] An admin's shared view shows for other users; they can't edit it.
- [ ] Shared view changes appear in the audit log; private ones don't.
- [ ] The menu is keyboard and screen-reader usable.

## Known limitations

- A view stores ids (template, user, key, batch). If one is deleted, the view
  still filters by it and shows no rows.
- No per-team sharing: shared is everyone (every deployment is one
  organisation, self-hosted).
- Relative time ("last 7 days") is kept as relative only where the table has
  such a filter (the generation log's `since`); fixed dates stay fixed.
