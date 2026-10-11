---
type: adr
title: LiquidJS for templating
description: LiquidJS is the one template language for designed templates, header/footer bands, overlay field expressions and API HTML, with custom filters and DB-backed partials for snippets.
tags: [architecture, api, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# LiquidJS for templating

## Status

Accepted.

## Context

Data has to get into documents in four places:
[document templates](../features/document-templates.md), header/footer bands
([ADR 0012](0012-headless-chromium-for-html-to-pdf.md)),
[overlay field](../features/pdf-overlay-templates.md) values, and HTML sent to the
[HTML to PDF API](../features/html-to-pdf-api.md). Each needs variables, conditions,
loops and formatting. Template authors are not developers and templates are
user input, so the language must not run arbitrary code.

## Decision

- Use **LiquidJS** everywhere a template meets data. One language, one set of
  filters, one place to learn. DocSpring uses Liquid too, so its users already
  know it.
- Liquid runs in the API, right before rendering.
- **Safe by configuration.**
  - Output is HTML-escaped by default; `| raw` opts out.
  - Unknown filters are errors, not silent blanks.
  - Only own properties of the data are readable.
  - Parse, render and memory limits stop runaway loops.
- **Custom filters:**
  - dates through dayjs, matching the app's
    [date.ts](../../apps/app/src/lib/date.ts) formats
  - currency and number formatting
  - `qrcode` and `barcode`, rendered with `bwip-js` to a `data:` URL
  - `asset_url`, which resolves an [asset](../features/assets.md) to the
    renderer's in-process asset origin
- **Partials from the database.** `{% render 'name' %}` loads a
  [snippet](../features/snippet-library.md) through a custom LiquidJS file
  system backed by Postgres. No partial reads from disk.
- Page tokens in bands (`{{ page }}`, `{{ pages }}`) are ordinary Liquid
  variables.

## Consequences

- Visual editor nodes ([ADR 0016](0016-tiptap-for-the-document-editor.md))
  compile to Liquid, so the visual mode and code mode share one runtime.
- Escaping by default makes merge values safe in HTML. Authors who want HTML
  from data must ask for it with `| raw`.
- Liquid has no user-defined functions. Logic beyond filters, `if` and `for`
  needs a new filter, written by us.
- Show-if conditions in the [guided form](../features/template-fields-and-guided-form.md)
  are not Liquid. They must run in the browser without the API.
