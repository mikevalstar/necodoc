---
type: feature
title: Archival, accessible and certified output
description: Per template and per request, generated PDFs can be PDF/A-2b or PDF/A-2u, tagged PDF/UA-1, and certified with the organisation's certificate (PAdES B-B or B-T, DocMDP allowing form fill and signing); every generation records what was applied.
tags: [product, pdf, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T06:02:41Z }
---

# Archival, accessible and certified output

## Summary

A template (or one API request) says how its PDFs are finished: PDF/A for
archives, tagged PDF/UA for screen readers, and a certification signature
from the organisation's certificate proving the file came from necodoc
unchanged. The generation log records what was actually applied.

## Motivation

The documents we fill end up filed: with courts, DMVs, records offices and
insurers. Many of them ask for PDF/A, public-sector customers have to publish
accessible documents, and a surety or insurer wants recipients to be able to
tell an issued bond from an edited copy. Today customers run outputs through
a second tool for each. necodoc rendered the file, so it can finish it.

## Behavior

Code: [output.ts](../../packages/shared/src/output.ts) (options and the
recorded profile), [render/finish.ts](../../apps/api/src/render/finish.ts)
(order), [render/conformance.ts](../../apps/api/src/render/conformance.ts)
([ADR 0037](../adrs/0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md)),
[render/certify.ts](../../apps/api/src/render/certify.ts) and
[certifier.ts](../../apps/api/src/certifier.ts)
([ADR 0038](../adrs/0038-pades-certification-signatures-built-with-pki-js.md)).

- **Output settings** live in template content, like signers, so versions,
  review fingerprints and diffs cover them. The editor's Output tab sets them
  ([-output-panel.tsx](../../apps/app/src/routes/_app/templates/-output-panel.tsx)).
  All are off by default; templates that never touch them keep their publish
  fingerprint.
  - **PDF/A**: off, PDF/A-2b or PDF/A-2u.
  - **PDF/UA**: tagged PDF/UA-1, with the document language
    ([Document localization](document-localization.md)). Designed
    templates and HTML renders only.
  - **Certify**: on or off.
- **Per request.** `/api/v1/render` and `/api/v1/combine` take an `output`
  object; template generate takes one too, and each field given overrides the
  version's setting ([HTML to PDF API](html-to-pdf-api.md)).
- **Order.** Render, then PDF/A and PDF/UA, then certification, so the
  signature covers the finished file. It applies to every render kind:
  designed templates, HTML, overlays and packets.
- **Never a false claim.** When a PDF can't honestly be PDF/A (an uploaded
  source with fonts it doesn't embed, JavaScript or attachments) or PDF/UA
  (overlays and packets have no structure), it's made without that claim and
  the generation gets a warning saying why.
- **Certification fails loudly.** A generation that asks for certification on
  a server without a certificate, or whose timestamp server doesn't answer,
  is an error, not an uncertified PDF. Previews skip certification.
- **Signing packages still work.** Certification is DocMDP level 2: filling
  fields and adding signatures in incremental updates keep it valid, so a PDF
  handed to DocuSign, Dropbox Sign or Adobe Sign stays certified
  ([Signing packages](signing-packages.md)).
- **Recorded.** Each generation stores its output profile (PDF/A level,
  PDF/UA, certifying subject and whether it was timestamped) and the time
  finishing took ([Generation log](generation-log.md)); the generation page
  and `/api/v1/generations/{id}` show it.

## Acceptance criteria

- [x] A designed template with PDF/A-2u and PDF/UA on, with header and footer
  bands, links, a table, an image with alt text, transparency and sign
  boxes, passes veraPDF for PDF/A-2u and PDF/UA-1
  ([conformance.test.ts](../../apps/api/src/render/conformance.test.ts)).
- [x] An overlay whose source embeds its fonts passes veraPDF PDF/A-2b; one
  that doesn't is made without the claim, with a warning naming the fonts.
- [x] A certified PDF verifies (byte range covers all but the signature, CMS
  valid, ETSI.CAdES.detached with signing-certificate-v2), stays PDF/A-2b,
  and carries DocMDP P=2
  ([certify.test.ts](../../apps/api/src/render/certify.test.ts)).
- [x] With a timestamp server configured, pyHanko reports a valid signature
  timestamp; after an approval signature is added, the certification is still
  valid with modifications "compatible with the document modification policy".
- [x] PKCS#12 and PEM identities, RSA and EC keys.
- [x] Settings in the editor, overrides through `/api/v1`, profile on the
  generation.

## Known limitations

- **PDF/A for overlays depends on the upload.** Most government forms use
  fonts they don't embed; fixing that needs the font programs, which a
  re-render with Ghostscript could substitute but necodoc doesn't
  ([ADR 0037](../adrs/0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md)).
- **No in-process validator.** The preflight catches the common blockers;
  only a validator like veraPDF proves conformance. Uploaded sources can fail
  in ways the preflight doesn't look for.
- **PDF/UA is as good as the content.** Missing alt text, empty headings or
  tables without header cells fail an accessibility check; necodoc doesn't
  lint them. Two Chromium quirks fail it too: decorative images (`alt=""`)
  and empty table cells are left untagged, so give images real alt text and
  put `&nbsp;` in empty cells.
- **Trust is the certificate's.** Acrobat shows the signature as trusted only
  if the certificate chains to a root it trusts (AATL, or the customer's own
  trust list). No revocation data is embedded: B-B or B-T, not B-LT or B-LTA.
- **Certify last.** A certified PDF put into a packet, or edited elsewhere, is
  no longer certified; certify the packet instead.
- One certificate per server; no HSM or cloud KMS yet.

## Open questions

- Should overlays offer a Ghostscript-based PDF/A conversion for sources that
  don't embed their fonts, as an optional worker dependency?
- B-LT (embedded OCSP/CRL) for customers who need validation after the
  certificate expires?
- Per-template or per-team certificates?
