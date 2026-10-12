---
title: Archival, accessible and certified output
description: Ask for PDF/A-2b or PDF/A-2u, tagged PDF/UA-1, and a PAdES certification signature, per template or per request.
sidebar:
  order: 9
---

Every render can be finished three ways, alone or together:

- **PDF/A-2b or PDF/A-2u**: the ISO archive format. `2u` also guarantees every character maps to Unicode, so text stays searchable.
- **PDF/UA-1**: a tagged PDF screen readers can follow. HTML renders and designed templates only.
- **Certification**: an invisible PAdES signature with the server's certificate. Viewers show who certified the document and that it hasn't changed; filling in form fields and adding signatures (DocuSign and the like) stay allowed.

## The `output` object

Send it on `POST /api/v1/render` and `POST /api/v1/combine`, or on `POST /api/v1/templates/{id}/versions/{version}/generate` to override the template's own settings field by field:

```json
{
  "output": { "pdfa": "2u", "pdfua": true, "certify": true, "lang": "en-CA" }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `pdfa` | `null` | `"2b"`, `"2u"` or `null` |
| `pdfua` | `false` | Tag the PDF for PDF/UA-1 |
| `certify` | `false` | Certify with the server's certificate |
| `lang` | `"en"` | The document language, a BCP 47 tag |

The generation (`GET /api/v1/generations/{id}`) reports what was applied in `outputProfile`, e.g. `{ "pdfa": "2u", "pdfua": true, "certified": { "subject": "Acme Surety", "timestamped": true } }`. When PDF/A or PDF/UA couldn't be applied, the PDF is still made and `warnings` says why. Certification is different: without a certificate on the worker, the generation fails.

## What to know

- **Accessible content is still your job.** Give images `alt` text, use real headings (`h1`–`h6`) and table header cells (`th`). Headers and footers are marked as page furniture automatically.
- **Overlay templates and uploaded PDFs** get PDF/A only when the source embeds its fonts and has no JavaScript or attachments; many government forms don't embed theirs. They're never tagged.
- **Certification needs a certificate on every worker**: see [Configuration](/self-hosting/configuration/#certifying-pdfs). For Acrobat to show the signature as trusted, the certificate must chain to a root it trusts, such as an [AATL](https://helpx.adobe.com/acrobat/kb/approved-trust-list1.html) certificate.
- **Certify last.** Combining a certified PDF into a packet, or editing it elsewhere, breaks the signature. Certify the packet itself instead.
- Previews are never certified.
