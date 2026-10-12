---
title: Generation log
description: Every logged render with its input, timings and output; filtering, export, signed links, re-runs, deletion and retention.
sidebar:
  order: 6
---

Every render except a live preview is a **generation**: from the app, the API, share links, packets, re-runs and batch rows.

## What's recorded

- Source: `app`, `api`, `share_link`, `combine`, `rerun` or `batch`.
- User (and API key, once `/api/v1` exists), template and version, batch and row.
- Status: `queued`, `running`, `success`, `error` or `cancelled`; the error message and warnings.
- Queued, started and finished times; the worker that ran it; the attempt count; the request id.
- Page count and size.
- The input (HTML or template data), and the output PDF in the configured [storage](/self-hosting/storage/).

### Timings

Each generation records where its time went, in milliseconds:

| Timing | Meaning |
| --- | --- |
| `queueWaitMs` | Queued until the last attempt started |
| `liquidMs` | Liquid for the body |
| `chromiumMs` | Chromium printing the body |
| `bandsMs` | Header and footer: their Liquid and printing |
| `stampMs` | Loading the body PDF, stamping the bands, saving |
| `finishMs` | PDF/A, PDF/UA and certification (with a timestamp server, its round trip) |
| `durationMs` | Run time on the worker |
| `totalMs` | Queued until finished |

## Generations page

Admins see every entry; everyone else sees their own, as "My generations". Filter by source, status, user (admins), template, batch, date range, minimum total time, minimum queue wait, and free text (file name, template name, error, request id, or any id). Sort by time, duration, queue wait, size, pages, attempts or file name. The filters live in the URL, so a view can be bookmarked or shared.

Internal API:

- `GET /api/generations`: the same filters as query parameters (`source`, `status`, `userId`, `templateId`, `batchId`, `from`, `to`, `q`, `minTotalMs`, `minQueueWaitMs`), plus `sort`, `order`, `limit` (up to 200) and `offset`. Returns `{ items, total }`.
- `GET /api/generations/export.csv`: the filtered list as CSV, metadata only, up to 100,000 rows.
- `GET /api/generations/:id`: one entry with its input and timings.

## Downloading

`GET /api/generations/:id/pdf` serves the PDF inline, or as an attachment with `?download=1`. It supports ETag revalidation and range requests. With `STORAGE_REDIRECT=presigned`, it redirects to a short-lived S3 presigned URL or Azure SAS instead of streaming through the API.

### Signed download links

`POST /api/generations/:id/link` mints a link that downloads the PDF without a session:

```json
{ "expiresInSeconds": 86400 }
```

`expiresInSeconds` is 60 to 604,800 (7 days); the default is 3,600. The answer is `{ "url": "...", "expiresAt": "..." }`. Anyone who can see the entry can mint one. Each link records who minted it and how often it was used.

An expired link answers `410`, a tampered one `403`. Links can't be revoked early, except by deleting the entry (or retention removing its output). Rotating `DOWNLOAD_SIGNING_SECRET` voids every live link.

## Re-run and delete

- `POST /api/generations/:id/rerun` renders the same input against the same template version and logs a new entry linked to the original. It's refused once retention has removed the input. The new PDF matches page for page, not byte for byte.
- `DELETE /api/generations/:id` removes the entry, its input and its stored PDF.
- `DELETE /api/generations?<filters>` (admins) bulk-deletes by filter. At least one filter is required.

## Retention

Admins set retention under Admin > System:

- **Outputs**: delete PDFs of generations that finished more than N days ago.
- **Inputs**: delete their input payloads after N days.

Each is 1 to 3,650 days, or keep forever (the default). Metadata always stays, so the log and its metrics keep the history. Retention runs once a day (03:17 UTC) on a worker, once per cluster, and on demand with "Run now". Inputs can hold personal data; set an input retention if that matters to you.
