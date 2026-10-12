---
type: feature
title: Personal data masking and erasure
description: Template fields can be marked sensitive; their values are masked in audit diffs and in other people's log entries, logs and traces never carry field values, and admins can find everything stored about a data subject and erase it (GDPR) with an erasure report.
tags: [product, admin, enterprise, privacy, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T06:24:52Z }
---

# Personal data masking and erasure

## Summary

Generated documents must contain personal data, so stored inputs, PDFs and
explicit exports keep it. Everywhere else it's masked. Admins can find
everything necodoc stores about one person and erase it on request.
Mechanism: [ADR 0039](../adrs/0039-sensitive-fields-masked-outside-stored-inputs-erasure-by-data-subject.md).

## Motivation

Enterprise customers process regulated data (SINs, tax ids, signatures) and
answer GDPR requests. Operators reading logs, admins browsing the log and
auditors reading change history shouldn't see that data, and some of those
places can never be cleaned up afterwards. Erasure requests need a tool, not
hand-written SQL.

## Behavior

- **Sensitive fields.** Each field in the
  [field designer](template-fields-and-guided-form.md) has a "Sensitive"
  setting: on, off, or automatic. Automatic treats signatures, and keys that look like
  a SIN/SSN, tax id, passport, birth date, bank account, IBAN or card number,
  as sensitive.
- **Where values stay whole:** the stored input of a generation (for re-runs),
  the PDF, submissions and share-link responses for their owner, downloads,
  signing packages, webhooks and the generation-log CSV (which has no values).
- **Where they're masked:**
  - **Logs and traces** never contain field values, sensitive or not. Render
    errors are logged with the input's values replaced by `[masked]`.
  - **Audit log** diffs mask sensitive values in template sample data,
    share-link prefills and test cases when the entry is written.
  - **Generation log**: an admin opening someone else's entry sees
    sensitive values masked; the owner sees them whole.
- **Subject key.** Generate and render calls (app and
  [`/api/v1`](html-to-pdf-api.md)) take an optional `subject`, such as the
  person's email or customer number. Share-link submissions use the respondent's
  email. The generation log shows it.
- **Admin > Data subjects:**
  - Search by a subject key or any value (an email, a name, an id). Matches
    are exact (case-insensitive) against the subject key, every stored value
    of a generation's data and signers, and a submission's answers and
    respondent email. Packets built from a matching generation are listed too.
  - The results show generations and submissions with why each matched. The
    admin can untick false positives, then erase.
  - Erasing deletes the generations (input, PDF and stored object in the
    storage driver), packets built from them, their webhook delivery logs and
    signed-link records, and the submissions and share-link responses.
  - The erasure report lists what was deleted by id, plus any stored objects
    the driver failed to delete. It can be downloaded as JSON.
  - The audit log records `privacy.subject_erased` with counts only, never the
    search term.
- Admins only.

## Implementation

- Field flag and masking: [fields.ts](../../packages/shared/src/fields.ts), [privacy.ts](../../packages/shared/src/privacy.ts).
- Log redaction and error scrubbing: [observability/logger.ts](../../apps/api/src/observability/logger.ts), [observability/render.ts](../../apps/api/src/observability/render.ts).
- Search and erasure: [privacy.ts](../../apps/api/src/privacy.ts), [routes/privacy.ts](../../apps/api/src/routes/privacy.ts); page: [admin/privacy.tsx](../../apps/app/src/routes/_app/admin/privacy.tsx).

## Acceptance criteria

- [ ] A field marked sensitive shows `[masked]` in an audit diff of sample data or a share-link prefill.
- [ ] An admin opening another user's generation sees sensitive values masked; the owner doesn't.
- [ ] A failed render's log line and span don't contain the input's values.
- [ ] Searching an email finds generations by subject key and by field value, and the share-link responses with that respondent email.
- [ ] Erasing removes the rows and the stored PDF objects, and the report lists them.
- [ ] The erasure audit entry doesn't contain the search term.

## Known limitations

- The audit log and shipped logs can't be erased (append-only, and out of the
  app's hands). Only flagged or pattern-matched fields are masked in audit
  entries. Names and emails of app users, failed sign-in emails and IPs stay.
- Entries written before this feature aren't masked retroactively.
- Exact matching misses misspellings and values inside longer text, like an
  HTML API body. API callers should send `subject`.
- Share-link prefills, template sample data and test cases aren't searched or
  erased; they're configuration, not submissions.
- Erasure is a hard delete. Analytics counts and batch progress drop with it.
- Data subjects who are app users are removed through
  [user management](user-management-and-roles.md), not this tool.
- Search scans stored inputs and isn't indexed beyond the subject key. It is
  fine at tens of thousands of entries but slow at millions.
