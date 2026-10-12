---
type: adr
title: PAdES certification signatures built with PKI.js
description: Generated PDFs are certified with an invisible DocMDP (P=2) signature whose CMS is built with PKI.js as ETSI.CAdES.detached with signing-certificate-v2, optionally timestamped by an RFC 3161 authority (B-T); the identity is a PKCS#12 or PEM pair from env, and the placeholder and byte range are written with pdf-lib.
tags: [architecture, pdf, security]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T06:02:41Z }
---

# PAdES certification signatures built with PKI.js

## Status

Accepted. Behaviour:
[Archival, accessible and certified output](../features/archival-accessible-and-certified-output.md).
Builds on [ADR 0013](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md);
works with [ADR 0033](0033-sign-boxes-located-by-anchor-text-handed-off-to-e-sign-providers.md).

## Context

Customers want recipients to be able to tell an issued document from an
edited copy, using their organisation's certificate. That's a certification
signature (DocMDP), and for European recipients it should be PAdES baseline
(ETSI EN 319 142-1): `ETSI.CAdES.detached`, an ESS signing-certificate-v2
attribute, no CMS signing-time, and optionally a signature timestamp (B-T).
It must not block the people signing later through an e-sign provider.

Options considered:

- **@signpdf/\*** (3.3). Handles the byte range, but its P12 signer
  (node-forge) writes plain PKCS#7 with signing-time and no
  signing-certificate-v2, and has no DocMDP or timestamping. We'd replace
  most of it.
- **node-forge alone.** Its PKCS#7 signer only knows three signed attributes
  and no unsigned ones, so no signing-certificate-v2 and no timestamp token.
- **PKI.js** (with asn1js). Full CMS SignedData with arbitrary signed and
  unsigned attributes, RFC 3161 request and response types and PKCS#12
  parsing, on WebCrypto. Maintained by PeculiarVentures.
- **Java or Python signers** (DSS, pyHanko). Capable, but a second runtime in
  every worker.

## Decision

- **PKI.js for the CMS** and pdf-lib for the PDF
  ([render/certify.ts](../../apps/api/src/render/certify.ts)). About 300
  lines of our own: placeholder, byte range, CMS, timestamp.
- **Certification, DocMDP P=2.** The signature dictionary carries a DocMDP
  reference and the catalog's `/Perms`; P=2 allows form filling and further
  signatures in incremental updates, which is what e-sign providers do. The
  widget is invisible (zero rect, print and locked flags, empty appearance) on
  page 1, so it doesn't break PDF/A or the layout.
- **PAdES baseline.** Signed attributes are content-type, message-digest and
  signing-certificate-v2 (SHA-256, with issuer and serial); the time is the
  dictionary's `/M`. With `CERTIFY_TSA_URL`, the signature value is
  timestamped and the token added as an unsigned attribute (B-T). RSA
  (PKCS#1 v1.5) and ECDSA keys, SHA-256.
- **Identity from env** ([certifier.ts](../../apps/api/src/certifier.ts),
  [env.ts](../../apps/api/src/env.ts)): `CERTIFY_P12_PATH` or
  `CERTIFY_CERT_PATH` + `CERTIFY_KEY_PATH`, with `CERTIFY_PASSWORD`. Loaded
  once per worker; the chain is ordered from the certificate matching the key
  and embedded. A certificate outside its validity period is refused.
- **Last step, after PDF/A and PDF/UA**
  ([render/finish.ts](../../apps/api/src/render/finish.ts)), on a full save
  without object streams so the placeholder is plain text. The placeholder is
  sized from the chain (plus room for a timestamp token) to keep files small.
- **Fail, don't degrade.** No certificate, a bad password or an unreachable
  timestamp server fails the generation. Previews aren't certified.
- **Verification**: tests verify the byte range and CMS with PKI.js against
  TEST-ONLY identities in [fixtures/certs](../../fixtures/certs/README.md)
  ([certify.test.ts](../../apps/api/src/render/certify.test.ts)). Checked by
  hand with poppler's pdfsig and pyHanko (signature valid, DocMDP
  FILL_FORMS, DigiCert timestamp valid, certification still valid after an
  approval signature is added).

## Consequences

- Two small pure-JS dependencies (pkijs, asn1js); no system packages.
- Keys live on worker disks (secrets mounted as files). HSM or cloud KMS
  signing would replace `Certifier.key` with a remote signer; not built.
- No revocation data (B-LT/B-LTA): validation after the certificate expires
  relies on the timestamp and the validator's own data.
- Combining certified PDFs into a packet re-saves them and drops their
  signatures; packets can be certified themselves.
