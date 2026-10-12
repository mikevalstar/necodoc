---
type: feature
title: Signing packages
description: Templates and HTML renders declare signers and sign boxes (signature, initials, date signed, full name, signer text); every generation returns the PDF plus where each box landed and envelope JSON ready for DocuSign, Dropbox Sign or Adobe Acrobat Sign.
tags: [product, pdf, api]
status: draft
---

# Signing packages

## Summary

A template says who signs and where. A generation then comes with a signing
package: the PDF, its signers, every sign box's page and rectangle, and
envelope or field JSON for an e-sign provider. necodoc hands the document off;
the provider runs the signing.

## Motivation

Most documents we fill end in signatures: surety bonds (principal, surety,
attorney-in-fact), contracts, applications. Customers already pay DocuSign,
Adobe Sign or Dropbox Sign for the legally binding part, which stays
[out of scope](competitive-scope.md#out-of-scope). What they lack is the
glue: today they place tabs by hand or hard-code coordinates that break when
the layout moves. necodoc knows where every box is, because it rendered it.

## Behavior

Code: [signing.ts](../../packages/shared/src/signing.ts) (model, provider
formats), [render/signing.ts](../../apps/api/src/render/signing.ts) (locating),
[signing-package.ts](../../apps/api/src/signing-package.ts) (responses).
Mechanism: [ADR 0033](../adrs/0033-sign-boxes-located-by-anchor-text-handed-off-to-e-sign-providers.md).

- **Signers.** A template lists its signers: an id (`principal`), a role label
  ("Principal"), a routing order, and name and email as Liquid over the
  template's data (`{{ principal_name }}`). The HTML API sends signers in the
  request. Signers are part of the content, so they're versioned and reviewed
  with it.
- **Sign boxes.** Kinds: `signature`, `initials`, `date_signed`, `full_name`,
  and `text` (filled by the signer). Each names one signer and can be optional
  (required by default). A signer can have many boxes; a document many
  signers.
  - **Designed templates:** a sign box block in the visual editor, sized in
    millimetres. It prints as an empty box with a signature line.
  - **Overlay templates:** a signature box with a signer and a kind
    ([PDF overlay templates](pdf-overlay-templates.md)). With a signer it is a
    handoff box and draws nothing; without one it still draws a signature
    image.
  - **HTML API / code mode:** any element with `data-sign` (the kind) and
    `data-signer` (the signer id), sized with CSS, e.g.
    `<span data-sign="signature" data-signer="buyer" style="width:60mm;height:14mm"></span>`.
    `data-sign-optional` makes it optional. Boxes in repeats appear once per
    item.
- **The package.** Every generation with signers or sign boxes stores one. It
  lists the resolved signers and, for each box: its id, signer, kind,
  required, page, and the rectangle three ways: PDF points from the bottom-left
  (what pdf-lib draws in), points from the top-left of the page as shown (72
  dpi pixels, what DocuSign uses), and 0..1 fractions of the page. Each box
  also has an anchor string (below), or null for overlays.
- **Anchors.** Rendered HTML boxes carry an invisible text token at their
  top-left corner. necodoc uses it to find the box; providers can use it to
  place tabs by text instead of coordinates, which survives later re-renders.
  On by default; `anchors: false` re-prints without them.
- **Provider formats.** From the package: a DocuSign envelope definition
  (document, signers with routing order, tabs by position or by anchor), Dropbox
  Sign `signers` and `form_fields_per_document`, and Adobe Acrobat Sign form
  fields. The PDF goes in as base64, or is left out with a signed download URL
  beside it.
- **API.** `signing: true` (or options: `formats`, `anchors`, `embedPdf`) on
  `/api/v1` render and generate answers JSON with the generation id, a signed
  PDF URL, signers, boxes and formats. `GET
  /api/v1/generations/{id}/signing-package` returns it for any generation
  ([HTML to PDF API](html-to-pdf-api.md)). The developer docs walk through a
  DocuSign handoff.
- **App.** A Signing panel in the template editor manages signers; sign boxes
  are added in the visual editor and the overlay editor. A generation's page
  offers the package (JSON, PDF) and a view that draws its boxes over the PDF
  pages, to check them by eye ([Generation log](generation-log.md)).
- Warnings, not failures: a box naming an unknown signer adds that signer with
  its id as the role; a box that couldn't be found is left out and said so.

- **Certified PDFs.** A certified output
  ([Archival, accessible and certified output](archival-accessible-and-certified-output.md))
  allows form filling and signing, so providers' signatures don't break it.

## Acceptance criteria

- [x] A surety bond overlay with principal, surety and attorney-in-fact signers
      returns boxes that line up with its signature lines when drawn over the
      rasterised PDF.
- [x] A designed template with sign boxes returns rectangles within a point of
      where the boxes print, on whichever page they fall.
- [x] The DocuSign envelope matches DocuSign's documented envelope shape.
- [x] `anchors: false` leaves no anchor text in the PDF; positions don't move.
- [x] Anchor text doesn't show in the printed or rasterised PDF.
- [x] The package is available from the app and from `/api/v1`.

## Known limitations

- Not an e-signature product: no signer identity, audit trail or ESIGN/eIDAS
  claims. The provider does that.
- Coordinates are as good as the PDF text layer: within about a point for
  rendered HTML, exact for overlays. Providers round to whole pixels.
- Anchor text is invisible but real: it shows up in copy-paste, search and
  text extraction.
- Sign boxes in headers and footers aren't located; put them in the body.
- A box split across a page break isn't supported; boxes avoid breaking
  inside.
- Packets ([Combining PDFs](combining-pdfs-into-packets.md)) don't carry the
  parts' packages.

## Open questions

- Create the envelope for the customer (store provider credentials) instead of
  handing off JSON? Only if asked: it means holding OAuth secrets per account.
