---
type: feature
title: HTML to PDF API
description: A versioned public API (/api/v1) that turns HTML with optional CSS, theme, header/footer bands, page options and Liquid data into a PDF, generates from published templates, and combines PDFs. Per-user API keys and an in-app docs page.
tags: [product, api, pdf]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# HTML to PDF API

## Summary

Developers send HTML or template data and get a PDF back in the same
response. The same renderer as the app, so API output matches previews.

## Motivation

Anvil and DocSpring both sell HTML to PDF as an API. Ours gets full-HTML
headers and footers with page numbers and a first-page variant, which
Chromium's own header templates can't do. Exposing the renderer lets necodoc
sit inside other products.

## Behavior

Mechanism: [ADR 0019](../adrs/0019-better-auth-api-keys-for-the-public-api.md).

- **API keys.** In Settings, each user with a role creates, names, lists and
  revokes their own keys, with an optional expiry. A key is shown once and acts
  with its owner's roles. Admins can list and revoke any user's keys.
- **Render HTML** (`POST /api/v1/render/html`):
  - `html` (required), Liquid allowed, rendered with `data`
  - optional `css`, appended after the theme
  - optional `theme` id ([Document themes](document-themes.md))
  - optional `header` and `footer`: `html`, `height`, optional `firstPageHtml`
  - optional page options: size (Letter, A4, Legal), orientation, margins
  - margins and band heights are millimetres
  - Liquid's `date` filter takes dayjs format tokens (`MMMM D, YYYY`), like the
    app, not strftime ([liquid.ts](../../apps/api/src/render/liquid.ts))
  - optional `filename`
- **Generate from a template** (`POST /api/v1/templates/:id/generate`): `data`
  validated against the template's fields
  ([Template fields and guided form](template-fields-and-guided-form.md)),
  optional `version` (default: latest published). Invalid data returns 422 with
  field errors.
- **Template schema** (`GET /api/v1/templates/:id/schema`): the JSON Schema for a
  version's data.
- **Combine** (`POST /api/v1/combine`): see
  [Combining PDFs into packets](combining-pdfs-into-packets.md).
- **Generations** (`GET /api/v1/generations/:id`, `.../pdf`): metadata and the
  PDF, for the key owner's own generations. Downloads stream from storage
  with ETag and range support, like the app's
  ([generation log](generation-log.md)); `POST .../link` mints a signed link
  for systems without the key.
- **Responses.** `Accept: application/pdf` returns the PDF bytes.
  `Accept: application/json` returns the generation id, page count, size and a
  download path. Errors are JSON with a code and message.
- **Limits.** Request bodies up to 20 MB, a render timeout, a per-key rate
  limit. Remote URLs in the HTML don't load; use [assets](assets.md) or `data:`
  URLs.
- Every call that renders is logged in the [generation log](generation-log.md)
  with the key used.
- **Render page** in the app ([render.tsx](../../apps/app/src/routes/_app/render.tsx)):
  the same request field by field, for trying HTML, bands, data and themes.
  Its preview mode isn't logged.
- **API docs page** in the app: every endpoint with its request and response
  schema (generated from the shared zod schemas), curl examples, and error
  codes.
- Optional [webhooks](webhooks.md) per key.

## Acceptance criteria

- [ ] A user can create a key, call render with it, and get a PDF; after
      revoking the key, the call returns 401.
- [ ] A key from a user without `document: view` gets 403.
- [ ] HTML with a header, footer, first-page header and page tokens renders
      like the same design in a designed template.
- [ ] Generating from a template with invalid data returns 422 with every
      failing field.
- [ ] `Accept: application/json` returns a generation id whose PDF downloads.
- [ ] Exceeding the rate limit returns 429.
- [ ] A request that references `http://169.254.169.254/` renders without
      fetching it.
- [ ] The docs page lists every `/api/v1` endpoint.

## Known limitations

- Synchronous calls wait up to a timeout, then return `202` with the
  generation id; async mode and batches are in
  [Render queue, batch jobs and scaling](render-queue-batch-jobs-and-scaling.md).
- No official SDKs. Plain HTTP and the docs page.
- No JavaScript in submitted HTML.
- No URL-to-PDF; the API never fetches a page for you.
- Chromium rounds page sizes given in millimetres up by under a point (A4 comes out
  595.9 × 841.9 pt rather than 595.3 × 841.9). Bands are positioned from each
  page's real size, so they still line up.
