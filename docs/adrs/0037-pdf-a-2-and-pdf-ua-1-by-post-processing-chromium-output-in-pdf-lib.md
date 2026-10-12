---
type: adr
title: PDF/A-2 and PDF/UA-1 by post-processing Chromium output in pdf-lib
description: Chromium prints tagged PDFs with embedded, Unicode-mapped fonts; pdf-lib adds what PDF/A-2 and PDF/UA-1 need at document level (XMP identification, sRGB output intent, file id, annotation flags, language, title, link descriptions), bands are stamped as artifacts, and a preflight withholds the PDF/A claim from sources it can't fix. No Ghostscript, verified with veraPDF.
tags: [architecture, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T06:02:41Z }
---

# PDF/A-2 and PDF/UA-1 by post-processing Chromium output in pdf-lib

## Status

Accepted. Behaviour:
[Archival, accessible and certified output](../features/archival-accessible-and-certified-output.md).
Builds on [ADR 0012](0012-headless-chromium-for-html-to-pdf.md) and
[ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md).

## Context

PDF/A-2 (ISO 19005-2) needs every font embedded, device colour tied to an
output intent, XMP metadata that identifies the part and matches the Info
dictionary, a file identifier, printable annotations with appearances, and no
encryption, JavaScript or non-PDF/A attachments. PDF/UA-1 (ISO 14289-1) needs
a structure tree with all content tagged or marked as an artifact, a language,
a displayed title and described links.

Options considered:

- **Ghostscript `-dPDFA=2`.** Converts almost anything, including PDFs with
  unembedded fonts (it substitutes them). But it re-writes the whole file:
  structure trees and form fields don't survive reliably, it's an AGPL system
  dependency in every worker image, and it's a process spawn per render.
- **A commercial engine** (Prince, PDFreactor) for HTML. Licensed per server,
  and doesn't help overlays.
- **Post-process in pdf-lib.** Chromium already embeds every font as a subset
  with a ToUnicode map and, with Playwright's `tagged: true` (and `outline`)
  on `page.pdf`, writes a structure tree from the HTML semantics. What's
  missing is document-level, which pdf-lib can write. Checked with veraPDF
  1.30 before deciding.

## Decision

- **Post-process in pdf-lib**
  ([render/conformance.ts](../../apps/api/src/render/conformance.ts)),
  in-process, after any render kind
  ([render/finish.ts](../../apps/api/src/render/finish.ts)): Info and XMP
  with identical title, producer and dates; `pdfaid` (and `pdfuaid`, declared
  as a PDF/A extension schema when both apply); an sRGB output intent; a file
  identifier; `/Lang`; `DisplayDocTitle`; annotations made printable and
  visible; `NeedAppearances` dropped; `/Contents` on links (Chromium writes
  none); `Tabs /S` for PDF/UA.
- **The ICC profile** is saucecontrol's CC0 `sRGB-v2-micro.icc` (456 bytes),
  inlined in [srgb-icc.ts](../../apps/api/src/render/srgb-icc.ts).
- **Tagged printing only when PDF/UA is asked for**
  ([render/browser.ts](../../apps/api/src/render/browser.ts)); bands print
  untagged and are stamped inside `/Artifact` marked content
  ([render/bands.ts](../../apps/api/src/render/bands.ts)), since headers and
  footers are pagination artifacts. Stamping doesn't touch the body's tags.
- **Levels offered: 2b and 2u.** 2u costs nothing more for Chromium output
  (every glyph is Unicode-mapped). PDF/A-3 is left out until attachments are
  a feature.
- **Preflight, never a false claim.** For PDF/A, every object is walked once:
  image `Interpolate` is removed (fixable); fonts without a font program,
  JavaScript and attachments are blockers, and the file is saved without the
  PDF/A identification and with a warning. PDF/UA is claimed only for
  Chromium's tagged output.
- **Verification is veraPDF in tests** when it's on PATH
  ([conformance.test.ts](../../apps/api/src/render/conformance.test.ts)),
  not at runtime: a JVM per render is too heavy for the worker.

## Consequences

- No new system dependency; the Dockerfile is unchanged.
- Designed templates and HTML pass veraPDF PDF/A-2u and PDF/UA-1
  (machine-checkable rules). Overlays pass PDF/A-2b when their source embeds
  its fonts; in the surety bond fixtures that's 2 of 11, the rest are refused
  with a reason.
- Accessibility beyond structure (alt text, heading order, table headers) is
  the author's; nothing lints it.
- If a customer needs PDF/A from arbitrary uploads, Ghostscript can be added
  later as an optional converter behind the same preflight.
