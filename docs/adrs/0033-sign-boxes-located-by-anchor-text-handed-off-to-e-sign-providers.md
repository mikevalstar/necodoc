---
type: adr
title: Sign boxes located by anchor text, handed off to e-sign providers
description: Rendered HTML sign boxes carry invisible start and end tokens that pdf.js finds in the printed PDF's text layer; overlay boxes keep their own rects; each generation stores the resulting signing package, and DocuSign, Dropbox Sign and Adobe Sign JSON is derived from it on read.
tags: [architecture, pdf, api]
status: stable
---

# Sign boxes located by anchor text, handed off to e-sign providers

## Status

Accepted. Behaviour: [Signing packages](../features/signing-packages.md).
Builds on [ADR 0012](0012-headless-chromium-for-html-to-pdf.md),
[ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md) and
[ADR 0028](0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md).
E-signature itself stays [out of scope](../features/competitive-scope.md#out-of-scope).

## Context

A signing package needs each sign box's page and rectangle in the finished
PDF. Overlay boxes have one already. Designed templates and API HTML don't:
Chromium decides where a box lands, and renders run with JavaScript off
([ADR 0012](0012-headless-chromium-for-html-to-pdf.md)), so the page can't
measure itself and report back.

Options considered:

- **Measure with JavaScript in a second, trusted page.** Needs script on in
  some context, and print layout can differ from screen layout.
- **Draw a marker colour and find it in a raster.** Works for empty boxes
  only, and costs a rasterisation per page.
- **Text tokens in the PDF.** Chromium writes text it draws in
  `color: transparent` (it drops `opacity: 0`), and pdf.js reports each text
  item's position. Verified in
  [signing.test.ts](../../apps/api/src/render/signing.test.ts).

## Decision

- **Tokens at two corners.** The renderer adds `~sigN~` at a box's top-left
  and `~endN~` at its bottom-right, absolutely positioned, 1px JetBrains Mono,
  transparent ([render/signing.ts](../../apps/api/src/render/signing.ts)).
  After printing the body, pdf.js finds them; monospace lets a token inside a
  merged text item be placed by character offset. Two corners give the size
  without parsing CSS, so any sizing works. Being absolute, tokens never move
  layout: `anchors: false` re-prints without them and positions hold.
- **The start token is also the anchor string.** DocuSign places tabs on text
  in the document and recommends hiding that text by colour
  ([DocuSign tab placement][ds-blog]); its matching ignores punctuation such as
  `~`, so tabs ask for whole-word matching.
- **One package per generation**, in `generation.signing`
  ([schema.ts](../../apps/api/src/db/schema.ts)): signers with Liquid-rendered
  name and email, boxes in three coordinate forms, page sizes. Provider JSON is
  built from it on read ([signing.ts](../../packages/shared/src/signing.ts),
  [signing-package.ts](../../apps/api/src/signing-package.ts)), so a format can
  change without re-rendering, and the PDF isn't stored twice as base64.
- **Signers live in template content**, like template CSS, so versions,
  review fingerprints and diffs cover them with no new column.
- **Provider formats**, from each provider's published API description:
  - DocuSign eSignature v2.1 ([OpenAPI][ds-spec]): an envelope definition with
    `status: "created"`, `documents[].documentBase64`, `recipients.signers[]`
    with `routingOrder` and `tabs`. Tab values are strings; positions are
    points (72 dpi) from the page's top-left. Sign Here and Initial Here take
    no width or height, and hang from an anchor by their bottom-left, so the
    anchor offset drops them by the box height. DocuSign has no public-URL
    document source, so the alternative to base64 is our signed link.
  - Dropbox Sign ([OpenAPI][hs-spec], [form fields][hs-ffpd],
    [help][hs-help]): flat `form_fields_per_document`; with `page` set, x/y are
    72 dpi, but width and height stay in its 80 dpi system, so they're scaled
    by 80/72. No full-name type: those become text.
  - Adobe Acrobat Sign v6 ([OpenAPI][as-spec]): `participantSetsInfo` with
    consecutive orders, and `formFields.fields[]` whose `locations[].top` is
    measured from the bottom of the page. `assignee` must be Adobe's
    participant set id, which only exists after the agreement does, so we put
    the signer id there for the caller to swap.

[ds-spec]: https://raw.githubusercontent.com/docusign/OpenAPI-Specifications/master/esignature.rest.swagger-v2.1.json
[ds-blog]: https://www.docusign.com/blog/developers/select-the-right-tab-placement-strategy-for-your-docusign-integration
[hs-spec]: https://raw.githubusercontent.com/hellosign/hellosign-openapi/main/openapi.yaml
[hs-ffpd]: https://developers.hellosign.com/docs/openapi/form-fields-per-document/
[hs-help]: https://help.dropbox.com/integrations/how-to-use-the-form-fields-per-document-parameter
[as-spec]: https://secure.na1.adobesign.com/public/docs/restapi/v6

## Consequences

- Positions come from the same PDF the customer gets, with no extra
  dependency: pdf.js is already server-side (ADR 0028).
- Accuracy is the text layer's: within about a point. Boxes in header and
  footer bands aren't found (bands are stamped as form XObjects, which
  DocuSign doesn't search for anchors either).
- Anchor text is real text: it shows in copy-paste and search. Dropping it
  costs one more Chromium pass.
- Every render with signers or sign boxes pays one pdf.js text pass.
- Provider shapes are ours to keep current; tests pin DocuSign's documented
  shape ([signing.test.ts](../../packages/shared/src/signing.test.ts)). We
  never call a provider, so there are no credentials to hold.
