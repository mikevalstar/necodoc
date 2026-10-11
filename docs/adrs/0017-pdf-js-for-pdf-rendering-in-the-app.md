---
type: adr
title: pdf.js for PDF rendering in the app
description: The app renders uploaded PDFs with pdfjs-dist in the field-placement editor and extracts text positions for AI detection; generated PDFs are previewed in an iframe.
tags: [architecture, app, frontend, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# pdf.js for PDF rendering in the app

## Status

Accepted. Builds on
[ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md).

## Context

The [overlay editor](../features/pdf-overlay-templates.md) draws field boxes on
top of an uploaded PDF's pages. It needs each page as a canvas at a known scale,
so screen positions convert exactly to PDF points. A browser's built-in PDF
viewer exposes none of that.
[AI field detection](0018-claude-api-for-ai-field-detection-and-drafting.md) also needs
page images and the text on each page with coordinates.

## Decision

- Use **pdfjs-dist** in the app, with its worker loaded through Vite.
- The overlay editor renders each page to a canvas and lays its own
  interactive layer of field boxes over it. The editor stores box positions in
  PDF points, origin bottom-left, the coordinates pdf-lib draws with
  ([ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
- pdf.js also reads each page's text content with positions, and its existing
  AcroForm fields, for import and AI detection.
- **Generated PDFs** (previews and downloads) are shown in an `<iframe>` using
  the browser's own viewer. No pdf.js there.

## Consequences

- Placement accuracy depends on our coordinate conversion, including rotated
  pages and non-zero crop boxes. Test fixtures must cover both.
- pdfjs-dist is large. The overlay editor route loads it lazily so the rest of
  the app doesn't pay for it.
- The iframe preview looks different per browser, and some mobile browsers
  download the PDF instead of showing it.
