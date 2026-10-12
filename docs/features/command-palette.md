---
type: feature
title: Command palette
description: Ctrl+K / Cmd+K, or the search button in the top bar, opens one box to jump to any page you can open, find templates, documents, generations, snippets, themes and users, and run common actions.
tags: [app, ux, navigation]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T12:46:34Z }
---

# Command palette

## Summary

One keyboard-first search box in the [app shell](app-shell-and-navigation.md):
type a few letters to open a page, a record, or run an action, without
walking the sidebar.

## Motivation

The sidebar groups about twenty pages under four sections, and records sit
one or two clicks deeper behind list filters. People who know what they want
("the Oregon bond template", "generation 3f2a…", "create an API key") should
get there in a few keystrokes. The [Cobalt mockups](design-system.md) put
"Search or jump to…" in the top bar for this.

## Behavior

- **Opening**: Ctrl+K (Cmd+K on macOS) anywhere in the signed-in app, or the
  "Search or jump to…" button in the top bar (an icon button at tablet
  width). Escape or picking an item closes it and focus returns to where it was.
- **Pages**: every page in the sidebar, filtered by the same access rules as
  the nav ([_app.tsx](../../apps/app/src/routes/_app.tsx),
  [auth.ts](../../apps/app/src/lib/auth.ts) `canAccess`), plus Settings and
  My usage. A page you can't open never shows.
- **Records**, once you type:
  - Templates, snippets (people who can open snippets), themes and your
    documents: matched in the browser on the lists those pages already load.
  - Generations: by file name or id, through the generation log's own search
    (`q`; admins see everyone's, others their own).
  - Users (admins): by name or email, opening Admin › Users filtered to them.
  Searching waits for a pause in typing and shows a few hits per group, each
  with a "show all" that opens the list page with the search filled in.
- **Actions**: New template, Upload PDF, New document, Create API key (each
  only for roles that can do it), switch light/dark theme, compact or
  comfortable table rows, and show or hide the [ops status bar](app-shell-and-navigation.md)
  (admins). Actions that open a dialog go to their page with the dialog open.
- **Recent**: with an empty box, the last few records and pages you opened
  from the palette come first. Stored in this browser only.
- **Accessibility**: a combobox input over a grouped listbox (Base UI
  Autocomplete inside a Dialog); arrow keys move, Enter opens, the first match
  is highlighted, and the dialog is labelled.
- Built in [command-palette.tsx](../../apps/app/src/components/command-palette.tsx)
  on [Base UI](../adrs/0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)'s
  Autocomplete; no `cmdk` dependency. No new API endpoints: it reuses the list
  endpoints the pages already call.

## Acceptance criteria

- [ ] Ctrl+K / Cmd+K opens the palette from any signed-in page; the top-bar
      button does too, at 820 px as well.
- [ ] A viewer sees no Admin pages, no Snippets and no New template action.
- [ ] Typing part of a template name lists it; Enter opens the template.
- [ ] Typing a generation's file name or id lists it and opens its detail.
- [ ] An admin finds a user by email and lands on Admin › Users filtered to them.
- [ ] "Create API key" lands on Developers › API keys with the create dialog open.
- [ ] Theme and table-row actions apply at once and survive a reload.
- [ ] Records opened from the palette show under Recent next time.
- [ ] Keyboard only: open, move, pick and close without a mouse; a screen
      reader announces the input as a combobox with a listbox.

## Open questions

- Search across template content or answers in documents would need a
  server-side search index; names only for now.
