---
type: adr
title: Hand-rolled SVG charts
description: The analytics dashboards draw their few chart forms (stacked columns, lines, horizontal bars) as plain React SVG in one component file, with a fixed, colour-blind-validated palette as CSS variables per theme, instead of adding a chart library.
tags: [architecture, app, frontend]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T23:40:09Z }
---

# Hand-rolled SVG charts

## Status

Accepted. Behaviour: [Analytics dashboards](../features/analytics-dashboards.md).
Builds on
[ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md).

## Context

The [analytics dashboards](../features/analytics-dashboards.md) need three
forms: stacked columns over time, lines over time (percentiles) and ranked
horizontal bars, each with a tooltip, a legend, a table view and both themes.
Chart libraries (Recharts, visx, Chart.js) bring their own defaults for marks,
colour and tooltips that we would mostly override, plus 50–150 kB.

## Decision

- Draw charts as **React SVG** in one file,
  [components/charts.tsx](../../apps/app/src/components/charts.tsx): a time
  axis over buckets the API returns, one linear y-scale, hairline grid,
  tooltip on hover and focus, legend, and a table toggle. No dependency.
- **Colours are fixed categorical slots** declared once as CSS variables for
  light and dark in [index.css](../../apps/app/src/index.css), checked for
  colour-blind separation. A series keeps its slot whatever the filters, and
  statuses (success, error) use their own fixed colours.
- One y-axis per chart; two measures of different scale are two charts.

## Consequences

- Small, consistent, themed charts with no new library to upgrade.
- New forms (scatter, heatmap, zoom, brushing) are ours to write; if the
  dashboards grow past simple time series and bars, revisit with a library.
