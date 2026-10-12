---
type: adr
title: Headless Chromium for HTML to PDF
description: The API renders HTML to PDF with headless Chromium through playwright-core, one shared browser, locked-down contexts, and headers/footers rendered as separate HTML band documents stamped onto each page.
tags: [architecture, api, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Headless Chromium for HTML to PDF

## Status

Accepted. Answers the PDF model question in
[Filling out a document](../features/filling-out-a-document.md): necodoc does
both. It generates PDFs from designed HTML templates (this ADR) and overlays
values onto existing PDFs
([ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)). Settles
the deploy target left open in
[ADR 0005](0005-hono-api-on-node-typed-through-its-rpc-client.md): Node.

Extended by [ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md): logged renders run on queue worker processes.

The fresh-context-per-render rule is superseded by [ADR 0047](0047-warm-chromium-pages-reused-across-renders.md): warm pages are reused across renders; JavaScript stays off and the network stays blocked.

## Context

[Document templates](../features/document-templates.md),
[document themes](../features/document-themes.md) and the
[HTML to PDF API](../features/html-to-pdf-api.md) all turn HTML and CSS into paginated PDFs.
Authors expect the CSS they know to work: flexbox, grid, tables that break
across pages, web fonts. Typst and react-pdf each bring their own layout
language, so users couldn't send us their own HTML.

The render input is user-controlled. A template or API call can contain
`<script>`, or URLs pointing at internal hosts. Rendering must not run user
code or make the server fetch anything.

Headers and footers are the hard part. Chromium's `headerTemplate` /
`footerTemplate` render in an isolated context: no page CSS, no images unless
inlined, tiny default font, and no first-page variant. CSS `@page` margin boxes
(Chrome 131+) accept only strings and counters, not HTML. Neither gives
GhostDraft-grade letterheads.

## Decision

- **Engine.** Headless Chromium driven by `playwright-core`, running inside the
  API process. The Chromium build comes from Playwright's browser cache
  (installed with the `playwright-core install chromium` CLI); `playwright-core`
  itself downloads nothing at install time.
- **One shared browser.** The API launches one browser lazily and reuses it.
  It relaunches if the browser crashes or disconnects.
- **Fresh context per render.** Each render gets a new browser context with
  JavaScript disabled, closed when the render ends. No cookies, storage or
  cache carry over between renders.
- **No network.** Every request from a rendered page is aborted, except
  `data:` and `blob:` URLs and requests to a reserved, never-resolving asset
  origin (a `.invalid` host). The renderer fulfils those in-process from
  stored [assets](../features/assets.md) and bundled fonts. Nothing a template
  references ever leaves the process, so there is no SSRF.
- **Limits.** An in-process semaphore caps concurrent renders. Each render has
  a timeout. Requests over the cap wait their turn rather than fail.
- **Header and footer bands.** Headers and footers are separate HTML documents
  ("bands"), each with a fixed height set by the author, plus an optional
  first-page variant. A render works like this:
  1. Render the body with top and bottom page margins that reserve the band
     heights (plus the author's own margins).
  2. Read the body's page count.
  3. For each band, render one multi-page PDF: page width by band height, one
     page per body page, with `{{ page }}` and `{{ pages }}` substituted per
     page and the first-page variant on page 1 when one exists.
  4. Stamp band page N onto body page N with pdf-lib
     ([ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).

  Bands get full HTML and CSS, the same theme as the body, images, and page
  tokens. A render costs at most three Chromium passes regardless of page
  count.
- Not used: Chromium `headerTemplate`/`footerTemplate` and `@page` margin
  boxes.

## Consequences

- Live previews call the same renderer, so the preview is the PDF the user
  will get, pagination included.
- The API must run on Node with a Chromium binary next to it. Edge runtimes are
  out. Containers need Chromium's system libraries, and each running browser
  costs a few hundred MB of memory.
- Authors pick a band height. Band content taller than its height is clipped,
  not reflowed.
- Templates can't use JavaScript: no client-side charts or computed layout.
  Dynamic content comes from Liquid
  ([ADR 0015](0015-liquidjs-for-templating.md)) before Chromium sees the page.
- Remote images and fonts don't load. Users upload them as assets or inline
  them as `data:` URLs.
- A hung or crashed render takes the shared browser down for everyone until
  relaunch. The timeout and relaunch logic must be tested.
