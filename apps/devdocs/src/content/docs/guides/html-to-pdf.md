---
title: HTML to PDF
description: Render HTML with CSS, a theme, header and footer bands and Liquid data to a PDF.
sidebar:
  order: 1
---

:::caution[Internal API]
This page documents `POST /api/render`, the endpoint the app's Render page uses. It authenticates with a session cookie (see the [Quickstart](/getting-started/quickstart/#4-render-a-pdf-with-curl)). The public API, authenticated with per-user API keys under `/api/v1`, is coming. Its paths and payloads may differ from these, and the [API reference](/reference/api/) will be generated from it.
:::

## Request

`POST /api/render` with a JSON body. Calling it needs the `document: view` permission (every role has it).

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `html` | string | required | HTML body. Liquid is rendered with `data` first. |
| `css` | string | | Appended after the theme's CSS. |
| `themeId` | uuid | | A saved [theme](/guides/themes-and-assets/). |
| `themeDraft` | object | | Unsaved theme `{ settings, css }`, used by the theme editor. Send `themeId` or `themeDraft`, not both. |
| `header` | band | | `{ html, height, firstPageHtml? }`. See [Headers, footers and page tokens](/guides/headers-footers/). |
| `footer` | band | | Same shape as `header`. |
| `page.size` | `Letter` \| `A4` \| `Legal` | `Letter` | |
| `page.orientation` | `portrait` \| `landscape` | `portrait` | |
| `page.margins` | `{ top, right, bottom, left }` | 20 each | Millimetres, 0 to 200. |
| `data` | object | `{}` | Variables for Liquid in the body and bands. |
| `filename` | string | | 1 to 200 characters. |
| `preview` | boolean | `false` | Render without logging a generation. |
| `async` | boolean | `false` | Answer `202` at once instead of waiting. Ignored for previews. |

Band heights and margins are millimetres.

```json
{
  "html": "<h1>Invoice {{ number }}</h1><p>Due {{ due | date }}</p><p>{{ total | currency }}</p>",
  "css": "h1 { margin-top: 0; }",
  "footer": { "html": "<p style=\"text-align:right\">{{ page }} / {{ pages }}</p>", "height": 10 },
  "page": { "size": "A4", "orientation": "portrait", "margins": { "top": 20, "right": 20, "bottom": 15, "left": 20 } },
  "data": { "number": "2026-0042", "due": "2026-11-01", "total": 1234.5 },
  "filename": "invoice-2026-0042"
}
```

Request bodies are limited to 20 MB.

## Responses

| Status | When | Body |
| --- | --- | --- |
| `200` | The PDF rendered | The PDF (`application/pdf`, inline) |
| `202` | Still queued or running after the wait, or `async: true` | `{ "generationId": "...", "status": "queued" \| "running" }` |
| `422` | Liquid or render error | `{ "error": "...", "generationId": "..." }` (`generationId` is `null` for previews) |
| `400` | The body doesn't match the schema | Validation errors |

A `200` carries `X-Page-Count`, and for logged renders `X-Generation-Id`.

### Synchronous and async

Logged renders run as jobs on a worker. A synchronous call waits for the job, up to `RENDER_WAIT_MS` (30 seconds by default), and returns the PDF. Past that it answers `202` with the generation id; the render continues. With `async: true` it answers `202` straight away.

Previews (`preview: true`) skip the queue and the log. They render on the API process, so they need no worker.

## Fetching a result later

Poll the generation, then download its PDF:

```sh
curl -b cookies.txt http://localhost:8080/api/generations/$ID
curl -b cookies.txt -o out.pdf http://localhost:8080/api/generations/$ID/pdf
```

`GET /api/generations/:id` returns the entry, including `status` (`queued`, `running`, `success`, `error`, `cancelled`), `error`, `pageCount`, `size` and `hasOutput`. `GET /api/generations/:id/pdf` serves the PDF inline, or as an attachment with `?download=1`. Downloads support ETags and range requests.

To hand the PDF to something without a session, mint a signed link. See [Generation log](/guides/generation-log/#signed-download-links).

## What the renderer allows

- **No network.** Remote URLs in the HTML don't load. Use [assets](/guides/themes-and-assets/#assets) via the `asset_url` filter, or `data:` URLs.
- **No JavaScript.** Pages render with JavaScript disabled.
- **Liquid is escaped by default.** `{{ value }}` is HTML-escaped; use `{{ value | raw }}` to output trusted HTML. Unknown filters are errors. See [Liquid](/guides/templates-and-liquid/#liquid).
- **Timeout.** A render that takes longer than 30 seconds fails.
- **Fonts.** Noto Sans is the default. Noto Serif, Inter and JetBrains Mono are bundled; other fonts come from uploaded font assets through a theme or `@font-face` in your CSS.

## Templates instead of HTML

To render a published template with validated data, see [Generating from a template](/guides/templates-and-liquid/#generating-from-a-template).
