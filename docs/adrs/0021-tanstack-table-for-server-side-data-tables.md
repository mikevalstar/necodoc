---
type: adr
title: TanStack Table for server-side data tables
description: Admin lists (generation log, later the render queue and others) share one DataTable built on @tanstack/react-table v9; the server filters, sorts and pages, and the URL holds the table state.
tags: [architecture, app, frontend]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T16:44:42Z }
---

# TanStack Table for server-side data tables

## Status

Accepted. Builds on
[ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md).

## Context

The [generation log](../features/generation-log.md) runs to tens of thousands
of rows and needs sorting, filtering, paging and optional columns. A
[render queue](../features/render-queue-batch-jobs-and-scaling.md) view and
other admin lists need the same. Hand-rolled `<Table>` markup per page repeats
that work each time and drifts.

## Decision

- Use **@tanstack/react-table** (v9), headless, rendered with the shadcn table
  primitives. It fits the TanStack Router/Query stack already in use.
- One shared [DataTable](../../apps/app/src/components/data-table.tsx):
  - **The server owns the rows.** It filters, sorts and pages; the app only
    ever holds one page. Table is used for column definitions and visibility.
  - **The URL owns the state.** Page, page size, sort, order, visible columns
    and the page's filters are search params validated with zod, so views are
    shareable and Back works.
  - **TanStack Query** fetches with `keepPreviousData`, so paging doesn't
    flash.
  - Filters are each page's own controls, passed in as a toolbar.

## Consequences

- A new list is column definitions, a zod search schema and a query; the table
  chrome comes for free.
- Every sortable column needs a server sort (and ideally an index); the table
  can't sort what the API doesn't.
- Total counts are a `count(*)` per page load. Fine at tens of thousands of
  rows; far larger tables would need estimates or keyset paging.
