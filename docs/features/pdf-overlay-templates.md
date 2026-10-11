---
type: feature
title: PDF overlay templates
description: Editors upload an existing PDF, place typed boxes on its pages (or import its AcroForm fields, or let AI detect them), map each box to data with a Liquid expression, and preview the filled PDF.
tags: [product, pdf, app, editor]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# PDF overlay templates

## Summary

An editor uploads a PDF they already use, draws boxes where answers go, and
maps each box to template data. Generation writes the values onto the original
pages.

## Motivation

Official and third-party forms must look exactly like the original. Retyping
them as HTML is slow and never matches. Most of these PDFs have no fillable
fields, or have badly named ones.

## Behavior

- **Upload.** A PDF up to 20 MB
  ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)). Encrypted and
  XFA PDFs are rejected with a reason
  ([ADR 0013](../adrs/0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
- **Placement editor**
  ([ADR 0017](../adrs/0017-pdf-js-for-pdf-rendering-in-the-app.md)). Pages
  render at zoomable scale. The editor draws, moves, resizes, duplicates and
  deletes boxes, with snapping and arrow-key nudging.
- **Box types:** text, multiline text, number, date, checkbox, image,
  signature, QR code.
- **Box options:**
  - font (bundled Unicode font or an uploaded font asset) and size
  - alignment: left, centre, right; top, middle, bottom
  - auto-shrink: reduce the font size down to a minimum until the value fits
  - for multiline: wrap within the box
  - for checkbox: the mark style, drawn when the value is truthy
- **Mapping.** Each box has a Liquid expression
  ([ADR 0015](../adrs/0015-liquidjs-for-templating.md)) over the template's
  [fields](template-fields-and-guided-form.md), e.g.
  `{{ first_name }} {{ last_name }}` or `{{ start_date | date: "MMM D, YYYY" }}`.
  Creating a box offers to create a matching field.
- **AcroForm import.** Existing form fields become boxes with their names,
  types and rectangles. An imported box can fill the original field by name
  instead of drawing over it.
- **AI auto-detect** (when enabled,
  [ADR 0018](../adrs/0018-claude-api-for-ai-field-detection-and-drafting.md)).
  Suggests boxes with names, types and fields. Suggestions show as unconfirmed
  until the editor accepts, edits or discards each one, or all at once.
- **Flatten** is a per-template option: when on, the output has no editable
  form fields.
- **Preview** fills the PDF with the template's sample data, shown in an
  iframe.
- Templates are drafts until published
  ([Publishing and versions](publishing-and-versions.md)).

## Acceptance criteria

- [ ] An editor can upload a PDF, place one box of each type, map them, and
      download a correctly filled preview.
- [ ] A value placed at a box lands in the same spot in the output, on normal,
      rotated and cropped pages.
- [ ] Non-Latin text (accents, Polish, Greek, Cyrillic) renders, not boxes.
- [ ] Auto-shrink keeps a long value inside its box down to the minimum size;
      past that the text is cut and the generation records a warning.
- [ ] AcroForm fields import with names and positions, and filling by name
      works with and without flatten.
- [ ] AI detection on a sample form returns suggestions that need confirming
      before they are saved.
- [ ] Encrypted and XFA uploads are rejected with a clear message.

## Known limitations

- Overlay images must be PNG or JPEG.
- No XFA, no encrypted PDFs.
- AI detection boxes are approximate and must be checked.
- Auto-shrink works per box; text never flows from one box into the next.
- A signature box draws an image. It is not a legally binding e-signature
  ([Competitive scope](competitive-scope.md)).

## Open questions

- Should a template be able to append designed pages (an HTML schedule) after
  the overlay pages?
