---
type: adr
title: pdf-lib for overlaying, stamping and merging PDFs
description: pdf-lib with @pdf-lib/fontkit and a bundled Unicode font writes values onto existing PDFs, fills AcroForm fields, stamps header/footer bands, and combines PDFs.
tags: [architecture, api, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# pdf-lib for overlaying, stamping and merging PDFs

## Status

Accepted. Second half of the PDF model answer in
[Filling out a document](../features/filling-out-a-document.md); the first half
is [ADR 0012](0012-headless-chromium-for-html-to-pdf.md).

## Context

Many organisations already have the PDF they need filled: a government form, a
carrier application, a contract. Rebuilding those as HTML is wasted work and
never looks identical. [PDF overlay templates](../features/pdf-overlay-templates.md)
write values onto the original pages instead.

Three other jobs need PDF editing on the server: stamping header/footer bands
onto body pages (ADR 0012),
[combining PDFs into packets](../features/combining-pdfs-into-packets.md), and reading page counts
and AcroForm fields from uploads.

## Decision

- Use **pdf-lib** in the API for all PDF editing, through its maintained fork
  `@cantoo/pdf-lib` (same API; upstream `pdf-lib` has had no release since
  2021). It is pure JavaScript, so it needs no native binaries.
- **Fonts.** Register `@pdf-lib/fontkit` and embed a bundled Unicode font
  (Noto Sans) by default. The standard 14 PDF fonts only cover WinAnsi, so
  names like "Zoë Łukasz" would fail without it. Uploaded TTF/OTF
  [assets](../features/assets.md) can replace it per field.
- **Overlay.** Draw text, multiline text, checkmarks, images (PNG/JPEG) and
  QR codes/barcodes at each field's rectangle, in PDF points. QR codes and
  barcodes are generated as PNG with `bwip-js`. Signatures are drawn images.
- **AcroForm.** When a field maps to an existing AcroForm field, set that
  field's value by name instead of drawing over it. Regenerate appearances
  with the embedded font.
- **Flatten** on request, so the output can't be edited.
- **Stamp** band pages onto body pages by embedding them as form XObjects.
- **Combine** by copying pages from each source into a new document.

## Alternatives considered

- **Draw everything with Chromium.** Render an HTML layer of positioned boxes
  and merge it over the original. It still needs a PDF library to merge, and it
  can't set AcroForm values.
- **qpdf / pdftk / Ghostscript.** Capable, but native binaries with their own
  licences, called through a shell.

## Consequences

- Overlay output keeps the original PDF intact: its vector content, its
  metadata, and any form fields that weren't flattened.
- pdf-lib can't open encrypted PDFs or fill XFA forms. Those uploads are
  rejected with a clear message.
- pdf-lib draws no SVG. Overlay images must be PNG or JPEG.
- Copying pages doesn't carry AcroForm fields, outlines or links into a
  combined document reliably. Packets flatten their inputs.
- We depend on a fork. If it stalls, upstream `pdf-lib` is API-compatible to
  fall back to.
