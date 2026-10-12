---
type: adr
title: Warm Chromium pages reused across renders
description: Each render slot keeps a warm, locked-down Chromium context and page and reuses it for later renders, recycling it after a failure, a timeout or 100 renders. Supersedes the fresh-context-per-render rule of ADR 0012 for speed; JavaScript stays off and the network stays blocked.
tags: [architecture, api, pdf, performance, security]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T18:07:14Z }
---

# Warm Chromium pages reused across renders

## Status

Accepted. Supersedes the **Fresh context per render** rule of
[ADR 0012](0012-headless-chromium-for-html-to-pdf.md); the rest of ADR 0012
stands.

## Context

ADR 0012 gave every render a new browser context, closed when the render
ended. A new page starts a Chromium renderer process. The
[performance benchmark](../features/performance-benchmark.md) showed that this
start-up, not printing, is most of the cost of a short document: about 30 ms
alone and much more under load, because on macOS it goes through the system
font daemon that every Chromium on the machine shares. Reusing one page across
renders was about 12 times faster in a Chromium-only test.

necodoc is self-hosted and single-tenant
([competitive scope](../features/competitive-scope.md)): every render on an
install belongs to the same customer. Per-render isolation protected one job
of that customer from another job of the same customer.

## Decision

- **Warm printers.** A printer is one context (JavaScript disabled) and one
  page. A render takes an idle printer or opens a new one, prints its body
  and bands on its page in turn, and gives it back. There are never more
  printers than render slots. Code: [browser.ts](../../apps/api/src/render/browser.ts).
- **Reset between renders.** After a clean render the page's document is
  replaced with an empty one and the printer's asset loader is cleared. The
  next render's `setContent` replaces the document again.
- **Recycle.** A render that fails or times out closes its printer. A printer
  is also closed after 100 renders, so a long-lived renderer can't creep in
  memory. Printers are dropped when the browser relaunches.
- **Unchanged from ADR 0012.** JavaScript off. Every request except the
  reserved asset origin is blocked, and asset requests go to the current
  render's own loader. Request routing turns off Chromium's HTTP cache, so a
  render doesn't read another render's asset bytes from cache. One shared
  browser per process, the render timeout and the concurrency cap stay.

## Consequences

- Throughput rises and the per-render renderer start disappears from the
  common path (numbers in the
  [performance benchmark](../features/performance-benchmark.md)).
- Renders on one printer are no longer isolated from each other. With
  JavaScript off a template can't read anything a previous render left
  behind, and its PDF contains only its own document. What can still carry
  over is Chromium's in-process state: in-memory caches (decoded fonts and
  images), memory growth, and the effect of a Chromium bug triggered by an
  earlier render. Both renders belong to the same customer's install. On the
  [public demo](../features/public-demo.md) every visitor already shares one
  admin account and sees the same data.
- A crash or hang still costs only that render: the printer is closed and the
  next render opens a new one.
- If necodoc ever renders for more than one tenant in one process, this
  decision must be revisited: give each tenant its own printers or go back to
  a context per render.
