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
  - user, and API key when there was one (shown by name; the log filters
    by key, which Admin › API keys links to)
  - template and version, if any
  - status (success or error), error message, warnings (e.g. text cut in an
    overlay box)
  - queued at, started at, duration, and a timing breakdown (queue wait,
    Liquid, Chromium, bands, stamping/overlay, finishing) from the
    [render queue](render-queue-batch-jobs-and-scaling.md)
  - output profile: PDF/A level, PDF/UA, and who certified it, if any
    ([Archival, accessible and certified output](archival-accessible-and-certified-output.md))
  - worker that ran it, attempt count, batch it belongs to, request id
  - page count, size
  - input payload (data or HTML)
  - output PDF, in the configured storage driver: disk, S3-compatible or
    Azure Blob ([ADR 0023](../adrs/0023-generated-outputs-in-object-storage.md))
- Live previews while editing are not logged.
- **Generations page** ([generations](../../apps/app/src/routes/_app/generations/index.tsx)):
  admins see every entry and filter by source, status, user, template, batch,
  date range, minimum duration and free text (file, template name, error,
  request id, or an id); sort by time, duration, size, pages or file name;
  choose which columns show; open one to see its input, error and output.
  It stays fast at tens of thousands of entries: the server filters, sorts
  and pages, and the page never loads the whole log. Filters, sort, page and
  columns live in the URL, so a view can be shared or bookmarked and Back
  undoes the last change. Built on the shared data table
  ([ADR 0021](../adrs/0021-tanstack-table-for-server-side-data-tables.md)).
- **Export** the filtered list (metadata, not PDFs) as CSV.
- **Retention** (admin setting): delete outputs, and optionally inputs, older
  than N days while keeping the metadata. Runs as a scheduled job; changes are
  recorded in the [audit log](audit-log.md).
- **Download** the output PDF (`GET /api/generations/:id/pdf`), inline or as
  an attachment with `?download=1`. Downloads stream from the driver and
  support ETag revalidation and range requests.
- **Signed link** (`POST /api/generations/:id/link`): anyone who can see an
  entry can mint a link to its PDF that works without a session until it
  expires (up to 7 days), for emails, webhooks or handing a PDF to another
  system. Each link records who minted it and how often it was used.
- **Re-run** renders the same input against the same template version and
  logs a new entry that links to the original.
- **Delete** removes the entry, its input and its output, including the
  stored object. Admins can bulk delete by filter.
- **Non-admins** see the same page as "My generations", without the user
  filter or bulk delete, for their own entries.

## Acceptance criteria

- [ ] A generation from each source appears with every field above.
- [x] A failed render shows its error and has no output.
- [x] An admin can filter, download, re-run and delete; a non-admin sees only
      their own entries.
- [ ] A re-run produces the same PDF as the original for an unchanged version.
- [x] Deleting removes the stored PDF bytes too.
- [x] A signed link downloads the PDF without a session and stops working
      after it expires.
- [x] A download answers range requests with 206 and a matching ETag with 304.

## Known limitations

- Inputs can hold personal data and are kept until deleted or removed by the
  retention setting.
- Outputs rendered before the storage driver existed stay in Postgres until
  `pnpm --filter @necodoc/api storage:migrate` moves them.
- Signed links can't be revoked before they expire, except by deleting the
  entry.
- Downloads aren't counted or audited yet, only signed-link use; minting a link
  and bulk deletes are in the [audit log](audit-log.md).
- Re-running an API render that used a since-deleted asset or theme fails.
- A re-run matches the original page for page, not byte for byte: Chromium stamps
  each PDF with its creation time.
- Bulk delete needs at least one filter, so one request can't wipe the whole log.
- Re-running an entry whose input retention removed is refused.
- The CSV export stops at 100,000 rows.

## Acceptance criteria (enterprise)

- [x] Every generation shows its timing breakdown, worker and attempts.
- [x] The filtered log exports as CSV.
- [x] A retention of N days removes older outputs and keeps their metadata.
