---
type: feature
title: Design system
description: The shared Cobalt look every page uses - tokens, type, icons, the shell, page frame, pills, tables with a compact mode, the PDF preview tray - and the rules that keep it from drifting.
tags: [app, ux]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T11:11:45Z }
---

# Design system

## Summary

Every page in the app is built from one set of tokens and shared components
in the Cobalt direction ([ADR 0042](../adrs/0042-cobalt-design-system-with-bricolage-figtree-and-phosphor.md)),
so pages adapt to it rather than invent their own look.

## Motivation

The app was consistent but generic. A distinctive, approachable look that
matches the brand helps self-serve users trust it, and one shared system keeps
29 pages from drifting apart as they're restyled.

## Behavior

- **Source of truth**: the approved mockups and token table in
  [design/directions](../../design/directions/README.md#c-cobalt-product-brand)
  (`cobalt/`); the tokens themselves are in
  [index.css](../../apps/app/src/index.css).
- **Shell** ([App shell and navigation](app-shell-and-navigation.md)): a
  collapsible cobalt sidebar and a top bar with breadcrumb, help and
  notifications.
- **Page frame** ([page.tsx](../../apps/app/src/components/page.tsx)): display
  title, one line on the page's purpose, actions on the right; empty states and
  skeletons.
- **Surfaces**: cards with shadows, not borders, on the lavender canvas.
- **Status**: pills on tinted washes with a dot (ok, warn, bad, running,
  muted), from the [badge](../../apps/app/src/components/ui/badge.tsx).
- **Next step**: marigold marks the single thing to do next on a screen (the
  next get-started step, an assistant suggestion). Never more than one.
- **Paper**: anything drawn on a white PDF page (overlay boxes) keeps the
  light-mode colours in dark mode (`.paper` in
  [index.css](../../apps/app/src/index.css)), so it stays legible.
- **Disabled** controls look clearly off in both themes (flat tint, muted
  text), not just faded.
- **Ears** only on the active nav item, the PDF preview tray
  ([pdf-frame.tsx](../../apps/app/src/components/pdf-frame.tsx)) and template
  thumbnails.
- **Tables** ([data-table.tsx](../../apps/app/src/components/data-table.tsx)):
  comfortable rows by default; a compact toggle on the table makes every table
  denser and is remembered in this browser
  ([density.ts](../../apps/app/src/lib/density.ts)).
- **Type and icons**: Bricolage Grotesque for titles and figures, Figtree for
  everything else, Fragment Mono for IDs and code; Phosphor icons.
- **Accessibility**: text pairs meet WCAG AA in light and dark; every
  focusable element shows the marigold focus ring; animations stop under
  `prefers-reduced-motion`.

## Acceptance criteria

- [ ] Home, Templates, the template editor and Generations read as the Cobalt
      mockups in light and dark.
- [ ] The sidebar collapses to an icon rail on request and at tablet width
      (820 px), with every page still reachable.
- [ ] The compact toggle changes table row height and survives a reload.
- [ ] Tabbing through any page shows the marigold focus ring on every stop.
- [ ] No fonts or icons load from a third-party host.

## Open questions

- A template gallery view, command palette and saved views appear in the
  mockups but aren't built; each needs its own spec first.
