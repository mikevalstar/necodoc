---
type: adr
title: Server-side PDF extraction and AI field detection as a queue job
description: The API reads page sizes and AcroForm fields from uploads with pdf.js in Node, and AI field detection runs as a pg-boss job on workers. It rasterises pages with @napi-rs/canvas, asks Claude for boxes in image pixels, then snaps them onto the page's real lines and squares. Supersedes ADR 0018's "the app extracts with pdf.js".
tags: [architecture, api, pdf, ai]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T18:06:09Z }
---

# Server-side PDF extraction and AI field detection as a queue job

## Status

Accepted. Supersedes the extraction point of
[ADR 0018](0018-claude-api-for-ai-field-detection-and-drafting.md) (the app
sent page images, text and AcroForm fields extracted with pdf.js) and the
matching line in [ADR 0017](0017-pdf-js-for-pdf-rendering-in-the-app.md). The
app still renders pages with pdf.js for the editor. Model calls go through the
AI module from [ADR 0022](0022-vercel-ai-sdk-for-all-ai-features.md); jobs run
on the queue from [ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md).
Feature: [PDF overlay templates](../features/pdf-overlay-templates.md).

## Context

A prototype on the [surety bond fixtures](../../fixtures/pdfs/surety-bonds/README.md)
compared approaches, scored against the 122 AcroForm widgets of the seven
fillable forms, which the model never saw:

- **Image only, boxes snapped to geometry** (chosen): Sonnet reads a page image
  and returns each field with a rough box in image pixels. The server snaps the
  box onto the rule, cell or square it belongs to. Recall at IoU 0.5 was 0.98,
  mean IoU 0.82, about $0.013 a page and 4 to 5 s a page (10 s on dense pages).
- **Candidates plus the model picking ids**: we extract every line and cell and
  the model picks from them. More tokens, it picked wrong cell borders, and it
  merged stacked lines.

Snapping needs the page's lines, cells and squares however they were drawn:
stroked paths, thin filled rectangles, `____` text and `☐` glyphs. All of them
look the same on a raster, so we find them on one. That means rendering pages
on the server, and if the server renders anyway, the browser has nothing to
extract.

## Decision

- **Upload extraction runs in the API** with `pdfjs-dist` (legacy Node build):
  page boxes and rotation, plus AcroForm fields (name, type, rectangle,
  tooltip, options, multiline, max length), stored with the upload. AcroForm
  import works from that list.
- **Rasteriser: `@napi-rs/canvas`.** It's a prebuilt native module with no
  system libraries to install, and pdf.js draws to it directly. Chromium
  (ADR 0012) can't take a pdf.js render without loading pdf.js into a page.
  Container images need its Linux build (glibc or musl to match the image).
- **Detection is a pg-boss job** (`detect-fields`) that workers run, like
  renders. The API enqueues it and answers with the job id; the app polls. The
  job output (the suggestions) stays in pg-boss's job table, and nothing else
  is stored. Caps: 20 pages and a 5-minute expiry per job, 90 s per page call.
- **Per page:** skip pages with no rules, underscores or squares (no model
  call). Otherwise render at most about 2 megapixels (larger images got
  downscaled by the API and the returned pixel coordinates drifted). Call the
  model with `effort: low`, then snap. Pages run in order, and each later
  prompt lists the keys earlier pages used, so a datum that appears twice
  gets one key. The template's existing field keys go into the prompt too.
- **Output** is suggestions: key, label, type, page, rectangle in PDF points,
  and `anchored` (true if the box snapped to a printed line, cell or square;
  false if it is the model's estimate). The app marks unanchored boxes as
  approximate, and "accept all" skips them.
- **Structured output** uses ai 7.x `generateText` with
  `Output.object({ schema })`. ai 7 deprecates `generateObject`, which ADR 0022
  named.
- Page content is untrusted. The prompt says so, and the output is a fixed
  schema the user reviews before anything is saved.

Code: [ai.ts](../../apps/api/src/ai.ts), [detect/](../../apps/api/src/detect/),
[pdf-source.ts](../../apps/api/src/render/pdf-source.ts).

## Consequences

- The browser needs no extraction code, and the API sees exactly what it will
  render.
- Workers carry a native canvas module and need `ANTHROPIC_KEY` too, or
  detection jobs fail with a clear error.
- Detection takes 5 to 10 s a page, so it's a job the user waits on, not part
  of the upload.
- Untested on scans, rotated pages and non-Letter sizes. Comb fields and
  sub-fields that share one line are weak spots.
