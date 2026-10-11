---
type: feature
title: Generation log
description: Every PDF render from the app, the API or a share link is recorded with source, user or key, template version, status, timing, size, error, input and output. Admins view, filter, download, re-run and delete; others see their own.
tags: [product, app, api, admin]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Generation log

## Summary

A record of every generated PDF: who made it, from what, how long it took, and
what came out. Admins see all of it; everyone else sees their own.

## Motivation

When a customer says "the PDF was wrong", someone needs the exact input, the
template version and the output it produced. Failures need their error. Usage
needs counting.

## Behavior

- **Recorded for every generation** from the app,
  [API](html-to-pdf-api.md), [share links](share-links-and-data-requests.md),
  [packets](combining-pdfs-into-packets.md) and re-runs:
  - source: app, API, share link, combine, re-run
  - user, and API key when there was one
  - template and version, if any
  - status (success or error), error message, warnings (e.g. text cut in an
    overlay box)
  - started at, duration, page count, size
  - input payload (data or HTML)
  - output PDF ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md))
- Live previews while editing are not logged.
- **Admin page** (Admin > Generations): filter by source, status, user,
  template and date range; sort by date or duration; open one to see its
  input, error and output.
- **Download** the output PDF.
- **Re-run** renders the same input against the same template version and
  logs a new entry that links to the original.
- **Delete** removes the entry, its input and its output. Admins can bulk
  delete by filter.
- **Non-admins** see a "My generations" list with the same view, re-run and
  download for their own entries.

## Acceptance criteria

- [ ] A generation from each source appears with every field above.
- [ ] A failed render shows its error and has no output.
- [ ] An admin can filter, download, re-run and delete; a non-admin sees only
      their own entries.
- [ ] A re-run produces the same PDF as the original for an unchanged version.
- [x] Deleting removes the stored PDF bytes too.

## Known limitations

- Inputs can hold personal data and are kept until someone deletes them. There
  is no automatic retention yet.
- Generated PDFs fill the database over time.
- Re-running an API render that used a since-deleted asset or theme fails.
- A re-run matches the original page for page, not byte for byte: Chromium stamps
  each PDF with its creation time.
- Bulk delete needs at least one filter, so one request can't wipe the whole log.

## Open questions

- A retention setting (e.g. delete outputs after N days, keep metadata)?
