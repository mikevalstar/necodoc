---
type: feature
title: Product tour reel
description: A short captioned video on the home page that walks an insurer's architect from an existing bond PDF through templates, the API, batch scale-out, signing packages and governance, built with Remotion from real screenshots and benchmark numbers.
tags: [product, marketing, web]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T13:58:20Z }
---

# Product tour reel

## Summary

The home page of the [marketing site](marketing-site.md) offers a 45-60 second
tour of necodoc, rendered from [apps/reel](../../apps/reel/README.md)
([ADR 0043](../adrs/0043-remotion-for-the-product-tour-reel.md)) and played in
the [Reel slot](../../apps/web/src/components/Reel.astro).

## Motivation

The architect reading the home page wants to see the product work before
reading about it. A minute of the real app, in order, answers "is this real
and does it fit our forms" faster than any copy.

## Behavior

Storyboard, one caption per scene, no voiceover:

1. An existing surety bond PDF is uploaded; AI proposes field boxes; a person
   confirms them in the [overlay editor](pdf-overlay-templates.md).
2. A designed [template](document-templates.md) shows a conditional section
   switching on and off.
3. The [guided form](filling-out-a-document.md) is filled and produces the PDF.
4. An [HTML to PDF API](html-to-pdf-api.md) call returns with its measured time.
5. A batch runs as workers are added ([render queue](render-queue-batch-jobs-and-scaling.md)).
6. A [signing package](signing-packages.md) is handed to an e-signature
   provider (DocuSign, Dropbox Sign, Adobe Sign): "e-signature ready".
7. The [audit log](audit-log.md) and [generation log](generation-log.md), and
   storage in the customer's own cloud (S3-compatible or Azure Blob).
8. Closing card: necodoc, self-hosted, open source (MIT), link.

Rules:

- Every number comes from the [benchmark](performance-benchmark.md) results
  file at render time, never typed.
- Visuals are real app screens or Cobalt recreations, with clean demo data
  (no test-named templates). Insurer customers are not named. The screens are
  captured from the seeded demo instance by `pnpm demo:screens`
  ([Demo data and screenshots](demo-data-and-screenshots.md)).
- Captions are burned in, large and high-contrast, and also shipped as a VTT
  track. Calm motion: pans, zooms, highlights; nothing flashes.
- The site never autoplays it. The poster shows until someone presses play,
  so reduced-motion visitors see a still unless they ask.

## Acceptance criteria

- [ ] `pnpm --filter reel render` writes MP4 (H.264), WebM, a poster PNG and
      a VTT into `apps/web/public/reel`.
- [ ] The MP4 is under 8 MB and 45-60 seconds, 1920x1080 at 30 fps.
- [ ] The home page reel plays it muted with controls and captions, with the
      chapter list as its text alternative.
- [ ] Changing the benchmark results and re-rendering changes the numbers on
      screen.

## Open questions

- None yet.
