---
title: Batches and async renders
description: Generate many documents from one template with JSON or CSV, follow progress, cancel, and download as a ZIP or a single packet.
sidebar:
  order: 5
---

## Async renders

Every logged render is a job on a queue that worker processes consume. Any generate call can be synchronous or async:

- **Synchronous** (default): the call waits for the PDF, up to `RENDER_WAIT_MS` (30 s by default). Past that it answers `202 { "generationId", "status" }` and the render carries on.
- **Async** (`"async": true`): the call answers `202` with the generation id at once.

Either way, poll the generation until `status` is `success`, `error` or `cancelled`, then fetch its PDF: `GET /api/v1/generations/:id` and `.../pdf` with an [API key](/guides/api-keys/), or `GET /api/generations/:id` and `.../pdf` from the app. To skip polling, subscribe a [webhook](/guides/webhooks/).

**Priorities.** Interactive renders (the app, single API calls) go ahead of batch rows, so a large batch doesn't block someone waiting on one PDF.

**Retries.** A job lost to a worker or browser crash retries on another worker, up to 3 attempts in all; the attempt count is on the generation. Template and data errors, including render timeouts, fail once and don't retry. A lost worker is noticed by its missed heartbeat, so a retry starts 10 to 20 seconds later.

## Batches

A batch generates one document per row from one published template version. Every row is validated against the version's fields; invalid rows fail on their own with their field errors, and the rest run.

### With an API key

The public API takes JSON batches:

| Call | Scope |
| --- | --- |
| `POST /api/v1/templates/:id/versions/:version/batch` | `batches:write` |
| `GET /api/v1/batches/:id` | `batches:read` |
| `GET /api/v1/batches/:id/zip` | `batches:read` |
| `GET /api/v1/batches/:id/packet` | `batches:read` |

The body is the same `{ rows, filename }` as the app's [JSON batch](#json). The v1 route answers `202` with the batch summary. A [webhook](/guides/webhooks/) on `batch.completed` fires once the last row finishes.

```sh
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"rows":[{"client_name":"Ada Lovelace"},{"client_name":"Grace Hopper"}]}' \
  https://necodoc.example.com/api/v1/templates/$TEMPLATE_ID/versions/latest/batch
```

The sections below use the app's session-authenticated routes (`/api/...`), which also take CSV and can cancel.

### JSON

`POST /api/templates/:id/versions/:version/batch` (`:version` is a number or `latest`):

```json
{
  "rows": [
    { "client_name": "Ada Lovelace", "amount": 1200 },
    { "client_name": "Grace Hopper", "amount": 950 }
  ],
  "filename": "statement"
}
```

`filename` is the base name; each PDF gets its zero-padded row number appended (`statement 01`, `statement 02`, ...). It defaults to the template name. A batch takes 1 to 10,000 rows.

### CSV

`POST /api/templates/:id/versions/:version/batch/csv`, multipart form:

- `file`: the CSV (header row first; RFC 4180 quoting; blank lines skipped).
- `mapping` (optional): JSON object from CSV column to field path. A path is a field `key`, or `group.N.key` for item N (from 0) of a repeating group.
- `filename` (optional): as above.

Without a mapping, columns named like a field path map to it: `key`, `group.N.key`, or `group.key` for the first item. Empty cells are left out, so field defaults apply. Values are converted to what the field expects; a value that doesn't convert stays a string so validation reports it.

```sh
curl -b cookies.txt -H 'Origin: http://localhost:8080' \
  -F file=@clients.csv \
  -F 'mapping={"Client":"client_name","Amount":"amount"}' \
  http://localhost:8080/api/templates/$TEMPLATE_ID/versions/latest/batch/csv
```

The app's two endpoints answer `201` with the batch summary (v1 answers `202`), `404` if the version isn't found, `409` if the template is archived, and `422` for an empty CSV or one over 10,000 rows.

In the app, a new batch (under **Developers › Batches**) takes the CSV upload and its column mapping.

### Progress and cancel

`GET /api/batches/:id` returns the summary:

```json
{
  "id": "...", "templateName": "Statement", "version": 3,
  "status": "running", "total": 500, "done": 212, "failed": 1, "cancelled": 0,
  "createdAt": "...", "cancelledAt": null, "finishedAt": null
}
```

`status` is `running`, `completed` (every row finished) or `cancelled`. `GET /api/batches` lists batches (yours; admins see all). Each row is a generation; filter the [generation log](/guides/generation-log/) by `batchId` to see them.

`POST /api/batches/:id/cancel` stops rows that haven't started. Rows already rendering finish.

### Downloads

- `GET /api/batches/:id/zip`: a ZIP of every finished PDF, in row order. It streams.
- `GET /api/batches/:id/packet`: one PDF with every row's pages, in row order. It's built in memory.

Neither is stored; both are rebuilt from the stored PDFs on each download, so they include whatever has finished so far.

## Limits

- 10,000 rows per batch. Split bigger runs into several batches.
- The request body (JSON or CSV) is limited to 20 MB.
- Each batch row stores its own copy of the compiled template as its input.
