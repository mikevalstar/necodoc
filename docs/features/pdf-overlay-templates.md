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

- **Upload.** A PDF up to 20 MB and 200 pages, kept in Postgres
  ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)). The API reads
  its page boxes and AcroForm fields on upload
  ([ADR 0028](../adrs/0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md)).
  - PDFs encrypted with an empty password (common on government forms) are
    accepted; outputs are saved unencrypted
    ([ADR 0027](../adrs/0027-encrypted-pdfs-with-an-empty-password-open-through-a-patched-pdf-lib.md)).
  - PDFs that need a password to open, and pure XFA forms, are rejected with a
    reason. Hybrid forms (XFA plus AcroForm) are accepted; the XFA part is
    dropped from outputs so every viewer shows the filled AcroForm.
  - The editor can replace the PDF with a new revision; boxes stay where they
    are.
- **Placement editor**
  ([ADR 0017](../adrs/0017-pdf-js-for-pdf-rendering-in-the-app.md),
  [overlay editor](../../apps/app/src/routes/_app/templates/-overlay-editor.tsx)).
  Pages render at zoomable scale with page thumbnails. The editor draws,
  moves, resizes, duplicates and deletes boxes, with arrow-key nudging.
- **Box model** ([overlay.ts](../../packages/shared/src/overlay.ts)): a page,
  a rectangle in PDF points (the page's own coordinates, origin bottom-left),
  a type and a value expression.
- **Box types:** text, multiline text, number, date, checkbox, image,
  signature, QR code, barcode.
  - A signature box can name a signer and a signing kind (signature, initials,
    date signed). That is the hook for [signing packages](competitive-scope.md);
    without one, a signature box draws the signature image.
- **Box options:**
  - font (bundled font or an uploaded TTF/OTF asset) and size
  - alignment: left, centre, right; top, middle, bottom; text colour
  - auto-shrink: reduce the font size down to a minimum until the value fits
  - for multiline: wrap within the box
  - for checkbox: the mark style, drawn when the value is truthy (not empty,
    `false`, `0` or `no`)
  - for barcode: the symbology
- **Mapping.** Each box has a Liquid expression
  ([ADR 0015](../adrs/0015-liquidjs-for-templating.md)) over the template's
  [fields](template-fields-and-guided-form.md), e.g.
  `{{ first_name }} {{ last_name }}` or `{{ start_date | date: "MMM D, YYYY" }}`.
  Output isn't HTML-escaped. The inspector autocompletes field keys and offers
  to create a field for a new box. Boxes that use undeclared fields are
  flagged.
- **AcroForm import.** One click turns the PDF's form fields into boxes and
  template fields: keys and labels from the field's tooltip or name, types
  from the field (text, multiline, checkbox, choice, signature) and from words
  like "date" in its name. Imported boxes fill the original field by name
  instead of drawing over it. Any box can be mapped to a form field.
- **AI auto-detect** (only when `ANTHROPIC_KEY` is set,
  [ADR 0018](../adrs/0018-claude-api-for-ai-field-detection-and-drafting.md),
  [ADR 0028](../adrs/0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md)).
  Suggests boxes with keys, labels and types; it runs as a background job and
  takes 5 to 10 seconds a page. Suggestions show apart from saved boxes until
  the editor accepts or rejects each one. Boxes that didn't snap to a printed
  line, cell or square are marked approximate, and "accept all" leaves them
  out. Accepting creates the box and, if its key is new, the field.
- **Flatten** is a per-template option: when on, the output has no editable
  form fields.
- **Rendering** ([overlay.ts](../../apps/api/src/render/overlay.ts)) shares
  the generation log, queue, batches and re-runs with designed templates. Its
  timings record Liquid as `liquidMs` and pdf-lib work as `stampMs`. Text that
  doesn't fit, unknown form fields and unreadable images are recorded as
  warnings on the generation and shown under the editor's preview.
- **Preview** fills the PDF with the template's sample data, shown in an
  iframe.
- Templates are drafts until published
  ([Publishing and versions](publishing-and-versions.md)).

## Acceptance criteria

- [ ] An editor can upload a PDF, place one box of each type, map them, and
      download a correctly filled preview.
- [ ] A value placed at a box lands in the same spot in the output, on normal,
      rotated and cropped pages.
- [x] Non-Latin text (accents, Polish, Greek, Cyrillic) renders, not boxes.
- [x] Auto-shrink keeps a long value inside its box down to the minimum size;
      past that the text is cut and the generation records a warning.
- [x] AcroForm fields import with names and positions, and filling by name
      works with and without flatten.
- [x] AI detection on a sample form returns suggestions that need confirming
      before they are saved.
- [x] Every fixture in [fixtures/pdfs/surety-bonds](../../fixtures/pdfs/surety-bonds/README.md)
      uploads, previews and fills, including the empty-password encrypted ones.
- [ ] Password-protected and pure XFA uploads are rejected with a clear message.
- [x] With `ANTHROPIC_KEY` unset, no AI control shows and the AI routes answer 404.

## Known limitations

- Overlay images are PNG or JPEG as they are; WebP and SVG are converted to PNG.
- Uploaded fonts must be TTF or OTF; WOFF2 falls back to Noto Sans with a warning.
- No pure XFA forms, no PDFs that need a password to open. Outputs of encrypted
  sources lose their permission flags and any digital signature.
- AcroForm imports name fields after the PDF's own field names, which tools often
  derive from the text before the blank, so some keys point at the wrong blank.
- AI detection is suggestions only. Measured on the 122 AcroForm widgets of the
  seven fillable fixtures: recall 0.97 at IoU 0.5, mean IoU 0.81, 5 to 12 s per
  document, about 1.5 cents a page. Multiline answers come back as one box or one
  per line, pre-filled blanks are suggested, and it is untested on scans,
  rotated pages and non-Letter sizes. Only the first 20 pages are checked.
- The editor has no snap-to-line; placement relies on dragging, the inspector's
  coordinates, AcroForm import or AI snapping.
- Replaced and deleted source PDFs stay in the database; there is no sweeper.
- Auto-shrink works per box; text never flows from one box into the next.
- A signature box draws an image. It is not a legally binding e-signature
  ([Competitive scope](competitive-scope.md)).

## Open questions

- Should a template be able to append designed pages (an HTML schedule) after
  the overlay pages?
