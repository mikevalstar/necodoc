---
type: adr
title: Cobalt design system with Bricolage, Figtree and Phosphor
description: The app's visual language is Cobalt, built from the neko mark - a solid cobalt sidebar, soft white cards on lavender with shadows instead of borders, pills for status, marigold for the one next step and the focus ring - with self-hosted Bricolage Grotesque, Figtree and Fragment Mono and Phosphor icons in place of Geist and Lucide.
tags: [architecture, app, ux]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T11:11:45Z }
---

# Cobalt design system with Bricolage, Figtree and Phosphor

## Status

Accepted. Restyles the shadcn components chosen in
[ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)
(the components and Base UI stay) and recolours slot 1 and the grid of the chart
palette in [ADR 0034](0034-hand-rolled-svg-charts.md). How it applies to pages is
in [Design system](../features/design-system.md).

## Context

The app looked like stock shadcn: consistent, but like every other admin tool.
Three directions were mocked on the same screens and data
([design/directions](../../design/directions/README.md)): Ledger (paper and ink),
Drafting (dense console) and Cobalt (product brand). The write-up recommended
Ledger; Mike picked Cobalt. necodoc is self-serve software that publishers,
form fillers and developers all use, and Cobalt is the most approachable of the
three and matches the marketing site and logo.

Every customer self-hosts ([competitive scope](../features/competitive-scope.md)),
often without outbound internet, so nothing can load from a font or icon CDN.

## Decision

- **Cobalt** ([direction C](../../design/directions/README.md#c-cobalt-product-brand)):
  lavender canvas, white cards with a two-layer shadow instead of borders, 16 px
  cards and 10 px controls, 40 px controls, pills on tinted washes for status,
  a solid cobalt sidebar, and marigold for the single next step and the focus
  ring. Light and dark themes are both first-class.
- **The ears** (the mark's cat ears, drawn with `clip-path`) appear in exactly
  three places: the active nav item, the PDF preview tray and template
  thumbnails. More would read as playful to enterprise buyers.
- **Tokens** live in one file, [index.css](../../apps/app/src/index.css), as the
  shadcn variables plus Cobalt names (canvas, tint, ink, washes, shell, sun),
  so shadcn components and page code use the same values.
- **Fonts**: Bricolage Grotesque for display text and figures, Figtree for UI,
  Fragment Mono for IDs and code, all from Fontsource packages bundled into the
  app. Geist is dropped.
- **Icons**: Phosphor (`@phosphor-icons/react`) replaces Lucide everywhere,
  including the vendored shadcn components. Duotone is the default weight.
- **Density**: comfortable by default, with a compact table mode stored per
  browser like the theme, because Cobalt is the least dense direction and
  admins live in tables.

## Consequences

- Most shadcn components are restyled in place (`components/ui`), so a later
  `shadcn add` of an existing component overwrites Cobalt styling; re-apply it.
- White on `#2f6bff` is exactly 4.5:1, so primary button text stays at 14 px
  semibold or heavier.
- Marigold on white is under 3:1, so the focus ring carries a thin dark inner
  edge in light mode to stay visible (WCAG 1.4.11).
- A Latin page loads about 120 kB of fonts (other subsets load only when a
  page uses them); Phosphor is tree-shaken to the icons used.
- Pages adapt to the shared components one by one; until then some look
  half-styled but keep working.
