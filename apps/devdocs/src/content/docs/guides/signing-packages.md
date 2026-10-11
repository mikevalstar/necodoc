---
title: Signing packages
description: Mark where each signer signs, get back the PDF with every sign box's page and position, and hand it to DocuSign, Dropbox Sign or Adobe Acrobat Sign.
sidebar:
  order: 8
---

necodoc doesn't collect signatures. It knows where every signature, initials and date box landed in the PDF it rendered, and gives you that, with JSON ready for your e-sign provider. The provider runs the signing, the signer identity and the audit trail.

## Signers and sign boxes

A **signer** has an `id` (what boxes refer to), a `role` label, a `routingOrder` (lower signs first; equal orders sign in parallel), and `name` and `email`. Name and email are Liquid over the document's data, e.g. `{{ principal_email }}`.

A **sign box** is for one signer and has a kind:

| Kind | DocuSign tab | Dropbox Sign | Adobe Sign |
| --- | --- | --- | --- |
| `signature` | `signHereTabs` | `signature` | `SIGNATURE` |
| `initials` | `initialHereTabs` | `initials` | `SIGNER_INITIALS` |
| `date_signed` | `dateSignedTabs` | `date_signed` | `SIGNATURE_DATE` |
| `full_name` | `fullNameTabs` | `text` | `SIGNER_NAME` |
| `text` (the signer types it) | `textTabs` | `text` | `DATA` |

Boxes are required unless marked optional.

**Templates.** Add signers on the template's **Signing** tab. In a designed template, insert a **Sign box** from the Insert menu or the `/` menu and size it in millimetres. In an overlay template, draw a signature box and pick a signer: it then prints nothing and goes in the package instead.

**HTML.** Any element with `data-sign` (the kind) and `data-signer` (the signer id), sized with CSS. Add `data-sign-optional` for an optional box. Send the signers with the request:

```html
<p>Buyer: <span data-sign="signature" data-signer="buyer" style="width:60mm;height:14mm;border-bottom:1px solid"></span>
   Date: <span data-sign="date_signed" data-signer="buyer" style="width:30mm;height:8mm"></span></p>
```

Sign boxes are `inline-block` and never split across pages. Boxes in a Liquid loop appear once per item. Boxes in headers and footers aren't found; put them in the body.

## Asking for the package

Add `signing` to a render or generate call. The answer is JSON instead of the PDF:

```sh
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"data": {"principal_name": "Pat Doe", "principal_email": "pat@example.com"}, "signing": true}' \
  https://necodoc.example.com/api/v1/templates/$TEMPLATE_ID/versions/latest/generate
```

`signing: true` means the defaults. As an object:

| Option | Default | |
| --- | --- | --- |
| `formats` | `["docusign"]` | Any of `docusign`, `dropbox_sign`, `adobe_sign`. |
| `anchors` | `true` | Keep the invisible anchor text in the PDF. `false` re-prints without it (one more render pass). |
| `embedPdf` | `true` | Put the PDF in the DocuSign envelope as base64. With `false`, fetch it from `pdfUrl`. |
| `placement` | `position` | DocuSign tabs by page coordinates, or `anchor` to place them on the anchor text. |

For any earlier generation (made with or without `signing`), `GET /api/v1/generations/{id}/signing-package?formats=docusign&formats=adobe_sign&embedPdf=false` answers the same. It needs `generations:read`. A document without signers or sign boxes gets an empty package with a warning. With `async: true` you get `202` first; fetch the package once the generation succeeds.

## The answer

```json
{
  "generationId": "236cb0c5-8d19-4b85-a665-34aa8c53d240",
  "filename": "Contractor bond.pdf",
  "pageCount": 2,
  "pdfUrl": "https://necodoc.example.com/api/files/…",
  "pdfPath": "/api/v1/generations/236cb0c5-…/pdf",
  "signers": [
    { "id": "principal", "role": "Principal", "routingOrder": 1, "name": "Pat Doe", "email": "pat@example.com" },
    { "id": "surety", "role": "Surety", "routingOrder": 2, "name": "Acme Surety Co.", "email": "bonds@acme.example" }
  ],
  "boxes": [
    {
      "id": "s1",
      "signerId": "principal",
      "kind": "signature",
      "required": true,
      "page": 2,
      "rect": { "x": 72, "y": 180.5, "width": 216, "height": 36 },
      "topLeft": { "x": 72, "y": 575.5, "width": 216, "height": 36 },
      "normalized": { "x": 0.11765, "y": 0.72664, "width": 0.35294, "height": 0.04545 },
      "anchorString": "~sig1~"
    }
  ],
  "pages": [{ "width": 612, "height": 792 }, { "width": 612, "height": 792 }],
  "anchors": true,
  "warnings": [],
  "formats": { "docusign": { "…": "below" } }
}
```

Each box's rectangle comes three ways, all in points (1/72 inch):

- `rect`: PDF user space, origin bottom-left. What pdf-lib and most PDF tools draw in.
- `topLeft`: from the top-left of the page as displayed (rotation included). What DocuSign, Dropbox Sign and Adobe Sign positions are based on.
- `normalized`: `topLeft` as fractions of the page, for drawing over an image of it at any size.

`anchorString` is invisible text at the box's top-left corner (null for overlay templates, whose boxes are exact without it).

## Worked example: DocuSign

`formats.docusign` is an [envelope definition](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/) for the eSignature REST API v2.1, created as a draft:

```json
{
  "emailSubject": "Please sign: Contractor bond.pdf",
  "status": "created",
  "documents": [
    { "documentId": "1", "name": "Contractor bond.pdf", "fileExtension": "pdf", "documentBase64": "JVBERi0xLjQK…" }
  ],
  "recipients": {
    "signers": [
      {
        "recipientId": "1",
        "routingOrder": "1",
        "name": "Pat Doe",
        "email": "pat@example.com",
        "roleName": "Principal",
        "tabs": {
          "signHereTabs": [
            { "documentId": "1", "pageNumber": "2", "xPosition": "72", "yPosition": "576", "tabLabel": "s1", "optional": "false" }
          ],
          "dateSignedTabs": [
            { "documentId": "1", "pageNumber": "2", "xPosition": "320", "yPosition": "590", "tabLabel": "s2", "width": "100", "height": "20" }
          ]
        }
      }
    ]
  }
}
```

Your integration gets an access token from DocuSign as usual (JWT grant or authorization code) and posts the envelope. necodoc never sees your DocuSign credentials.

```ts
import { createNecodocClient } from "@necodoc/sdk";

const necodoc = createNecodocClient({ baseUrl: NECODOC_URL, apiKey: NECODOC_API_KEY });

// 1. Generate the bond and its signing package.
const { data: pkg, error } = await necodoc.POST("/templates/{id}/versions/{version}/generate", {
  params: { path: { id: BOND_TEMPLATE_ID, version: "latest" } },
  body: { data: bondData, signing: { formats: ["docusign"] } },
});
if (error) throw new Error(`${error.code}: ${error.error}`);
if (!pkg || !("formats" in pkg)) throw new Error("Still rendering: fetch the package later");

// 2. Send it: "sent" emails the first signers now; leave "created" to review it in DocuSign first.
const envelope = { ...pkg.formats.docusign, status: "sent" };
const res = await fetch(
  `${DOCUSIGN_BASE_URI}/restapi/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/envelopes`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${docusignAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  },
);
if (!res.ok) throw new Error(`DocuSign: ${res.status} ${await res.text()}`);
const { envelopeId } = await res.json();
```

Notes:

- DocuSign values are strings; necodoc rounds positions to whole points.
- Sign Here and Initial Here tabs size themselves (DocuSign doesn't take a width or height for them), so they sit at the box's top-left rather than filling it. Leave room for DocuSign's own graphic, and use `scaleValue` (0.5 to 2) to resize it.
- `placement: "anchor"` replaces page coordinates with the box's anchor string, matched as a whole word. Sign Here and Initial Here hang from an anchor by their bottom-left, so they get an `anchorYOffset` of the box height. Check this against your account once: necodoc's anchors are transparent text, where DocuSign's own guidance uses white text.
- `emailSubject` is cut to DocuSign's 100 characters. Change it, or add `emailBlurb`, before sending.
- `roleName` is the signer's role; it matters only if you turn the envelope into a DocuSign template.
- For embedded signing, add `clientUserId` to each signer yourself.

## Dropbox Sign

`formats.dropbox_sign` has `signers` (in signing order, with `order`) and a flat `form_fields_per_document` for `POST /v3/signature_request/send`. Upload the PDF in `files[]` or pass `pdfUrl` in `file_urls[]`. Each field has `page`, so x and y are 72 dpi from the top-left; width and height are scaled to Dropbox Sign's 80 dpi sizing. Dropbox Sign has no full-name field, so `full_name` boxes become `text`. Its field placement is designed around US Letter pages.

## Adobe Acrobat Sign

`formats.adobe_sign` has `participantSetsInfo` (orders made consecutive from 1) for `POST /agreements`, and `formFields` for `PUT /agreements/{id}/formFields`. Upload the PDF to `/transientDocuments` first and create the agreement in the `AUTHORING` state. Adobe measures `locations[].top` from the bottom of the page; necodoc converts. `assignee` holds the necodoc signer id: replace it with the participant set id Adobe returns from `GET /agreements/{id}/members`, matching by email.

## Checking positions

In the app, a generation with signers or sign boxes shows a **Signing package** section: the signers, downloads for the package JSON and the PDF, and **Show boxes on the PDF**, which draws every box over the rendered pages.

## Limits

- Not an e-signature product: no signer identity checks, audit trail or ESIGN / eIDAS claims. That's the provider's.
- Positions for HTML come from the PDF's text layer: within about a point. Overlay boxes are exact.
- Anchor text is invisible but real: it shows up when someone copies or searches the PDF text. Use `anchors: false` if that matters.
- Packets from `/combine` don't carry their parts' packages.
- necodoc doesn't call DocuSign, Dropbox Sign or Adobe Sign, store their credentials, or follow envelope status.
