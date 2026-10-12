---
type: adr
title: Sensitive fields masked outside stored inputs, erasure by data subject
description: Field values stay whole in stored inputs, PDFs and explicit exports; logs and spans never carry them; audit diffs and other people's log entries mask fields flagged sensitive (or matching default patterns) at write or read time; GDPR erasure finds a data subject by subject key or exact field value and deletes their generations, files and submissions, recording only counts.
tags: [architecture, security, privacy, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T06:24:52Z }
---

# Sensitive fields masked outside stored inputs, erasure by data subject

## Status

Accepted. Behaviour:
[Personal data masking and erasure](../features/personal-data-masking-and-erasure.md).
Builds on [ADR 0032](0032-append-only-audit-log-with-a-request-scoped-actor.md)
(append-only audit log) and
[ADR 0036](0036-pino-logs-prometheus-metrics-and-opt-in-opentelemetry-traces.md)
(logs and traces).

## Context

Documents exist to carry personal data: the PDF must show the name, the SIN,
the signature. So stored inputs (needed for re-runs), the generated PDFs and
explicit exports keep real values. Everywhere else a value travels (log lines,
trace spans, audit diffs, an admin looking at someone else's log entry) it
reaches people who don't need it, and some of those stores (the audit log, a
log pipeline) can't be cleaned later.

Separately, customers get GDPR erasure requests ("delete everything about this
person") and need to answer them without hand-written SQL.

Options considered:

- **Encrypt sensitive values at rest, keys per subject (crypto-shredding).**
  Erasure becomes deleting a key, but every render, re-run and search has to
  decrypt, and PDFs in storage still hold plain text. Too much machinery for
  what customers asked for.
- **Mask stored inputs too.** Breaks re-runs and the owner's view of their own
  documents. Rejected by the product decision above.
- **Mask outside stored inputs; delete rows for erasure.** Chosen.

## Decision

- **Sensitivity lives on the field.** A field may be flagged `sensitive`.
  Unflagged fields are sensitive by default when they're signatures or their
  key looks like a government id, tax number, birth date or account/card
  number; an explicit `false` opts out. One function,
  [`maskData`](../../packages/shared/src/privacy.ts), applies it, so the API
  and the app agree.
- **Logs and spans carry no field values at all**, flagged or not: operators
  never need them. pino redacts `data`, `input` and `fields` wherever they
  appear as a backstop, and render errors are scrubbed of the input's values
  before they're logged or put on a span. The stored error on the generation
  stays whole for its owner.
- **Audit entries are masked when written.** The log is append-only, so a
  value that goes in can never come out. Sample data, share-link prefills and
  test-case data in diffs pass through `maskData` with the template's fields.
- **Reads mask for non-owners.** An admin opening someone else's generation
  sees sensitive values masked; the owner sees them whole.
- **A subject key on generations.** An optional `subject` (an email, a
  customer number) can be given on generate and render calls; share-link
  submissions use the respondent's email. It's indexed, so erasure can find
  API renders whose data has no recognisable field.
- **Erasure deletes rows.** Search matches the subject key or any string value
  in stored data exactly (case-insensitive), never substrings, so a common word
  can't sweep up unrelated people. The admin reviews and deselects matches;
  erasing deletes the generations (and packets built from them), their stored
  files through the storage driver, their webhook delivery logs and the
  submissions. The audit entry records counts only, never the search term.

## Consequences

- Nothing already in the audit log or shipped log pipelines can be erased; masking
  at write time is what keeps that acceptable, and it only works for fields
  someone flagged (or that match a default pattern).
- Exact matching misses misspellings and values embedded in longer text (HTML
  API bodies); the subject key is the reliable route for API callers.
- Erasure is a hard delete: analytics counts and batch totals drop with it.
- Unflagged fields (a plain "name" field) are shown to admins in other people's
  entries and kept in audit diffs; flagging them is the template author's job.
