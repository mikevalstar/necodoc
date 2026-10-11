---
type: adr
title: Encrypted PDFs with an empty password open through a patched pdf-lib
description: Overlay uploads encrypted with an empty user password are accepted and loaded with password '' through a pnpm patch to @cantoo/pdf-lib that fixes its decrypt path; outputs are saved unencrypted and PDFs that need a real password are rejected. Supersedes ADR 0013's "encrypted uploads are rejected".
tags: [architecture, api, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T18:06:09Z }
---

# Encrypted PDFs with an empty password open through a patched pdf-lib

## Status

Accepted. Supersedes one point of
[ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md): encrypted
uploads are no longer all rejected. The rest of 0013 stands. Used by
[PDF overlay templates](../features/pdf-overlay-templates.md).

## Context

Four of the eleven public surety bond forms in
[our fixtures](../../fixtures/pdfs/surety-bonds/README.md) (NY VS-3, CA OL25B,
SC DLA-1B, University Place WA) are encrypted with an empty user password.
Viewers open them without asking for anything, so users don't know they are
encrypted. Government forms do this a lot, to set owner permissions.

Stock `@cantoo/pdf-lib` 2.11.1 fails on them. With `ignoreEncryption` it parses
ciphertext object streams and loses the page tree (`Expected instance of
PDFDict`). With `{ password: '' }` it decrypts, but three bugs in its decrypt
path corrupt the result:

1. Decrypted strings are written back as literal strings without escaping, so
   unbalanced `(`, `)` and `\` bytes break the file.
2. Cross-reference streams, streams with the Identity crypt filter, and
   metadata under `EncryptMetadata false` are decrypted although they are
   stored in the clear (ISO 32000-2 7.5.8.4, 7.6.5, 7.6.4.4).
3. The `/Encrypt` dictionary and the old cross-reference streams are left in
   the saved file, which then claims to be encrypted.

## Decision

- Load every uploaded PDF with `PDFDocument.load(bytes, { password: '' })`.
- Fix the three bugs with a `pnpm patch`
  ([patches/@cantoo__pdf-lib@2.11.1.patch](../../patches/@cantoo__pdf-lib@2.11.1.patch)):
  decrypted strings become hex strings, streams stored in the clear are left
  alone, and the stale `/Encrypt` and xref streams are dropped after decrypting.
- [pdf-source.test.ts](../../apps/api/src/render/pdf-source.test.ts) loads,
  stamps, saves and reloads all eleven fixtures, and checks that page count,
  page text, vector content and form fields survive and the output isn't
  encrypted.
- Outputs are saved **unencrypted**.
- A PDF that needs a real password to open is rejected at upload with a
  message saying so. We don't ask for passwords.
- We also switch the fontkit we register from `@pdf-lib/fontkit` to
  `@cantoo/fontkit`. The fork's font subsetter calls the fontkit 2 `encode()`
  API, so `@pdf-lib/fontkit` fails on every subset embed.

## Alternatives considered

- **pdf.js `saveDocument()` round trip** to normalise uploads. It writes an
  incremental update over the encrypted original, so pdf-lib still has to
  decrypt it.
- **qpdf `--decrypt`** before loading. Robust, but it's a native binary,
  which ADR 0013 avoided.
- **Reject encrypted uploads** (ADR 0013). That turns away common government
  forms that every viewer opens without a prompt.

## Consequences

- Empty-password encrypted forms upload, preview and fill like any other.
- The owner-permission flags (no printing, no editing) are gone from the
  output. The issuer set them, but anyone can strip them anyway, since the user
  password is empty.
- Any edit invalidates a digital signature in the source (the CA form has one).
- We maintain a patch. On a pdf-lib upgrade, `pnpm install` fails if the patch
  no longer applies, and the fixture test catches a regression. The fixes are
  worth sending upstream.
