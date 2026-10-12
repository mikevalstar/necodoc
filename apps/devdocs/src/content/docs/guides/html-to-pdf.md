---
title: HTML to PDF
description: Render HTML with CSS, a theme, header and footer bands and Liquid data to a PDF through /api/v1, and combine PDFs.
sidebar:
  order: 1
---

`POST /api/v1/render` turns HTML into a PDF. It needs an [API key](/guides/api-keys/) with the `render:html` scope.

```sh
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"html":"<h1>Hello {{ name }}</h1>","data":{"name":"world"}}' \
  -o hello.pdf -D - \
  https://necodoc.example.com/api/v1/render
```

## Request

A JSON body:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `html` | string | required | HTML body. Liquid is rendered with `data` first. |
| `css` | string | | Appended after the theme's CSS. |
| `themeId` | uuid | | A saved [theme](/guides/themes-and-assets/). |
| `header` | band | | `{ html, height, firstPageHtml? }`. See [Headers, footers and page tokens](/guides/headers-footers/). |
| `footer` | band | | Same shape as `header`. |
| `page.size` | `Letter` \| `A4` \| `Legal` | `Letter` | |
| `page.orientation` | `portrait` \| `landscape` | `portrait` | |
| `page.margins` | `{ top, right, bottom, left }` | 20 each | Millimetres, 0 to 200. |
| `data` | object | `{}` | Variables for Liquid in the body and bands. |
| `filename` | string | | 1 to 200 characters. |
| `response` | `pdf` \| `json` | `pdf` | `json` answers with the generation and a download link instead of the bytes. |
| `async` | boolean | `false` | Answer `202` at once instead of waiting. |
| `signers` | array | | Who signs the `data-sign` boxes. See [Signing packages](/guides/signing-packages/). |
| `signing` | `true` \| object | | Answer with a signing package instead of the PDF. |
| `output` | object | | `{ pdfa?, pdfua?, certify?, lang? }`. See [Archival, accessible and certified output](/guides/archival-and-certified-output/) and [Localization](/guides/localization/). |
| `translations` | object | | Text for the `t` filter per language; `output.lang` picks one. See [Localization](/guides/localization/#translations). |
| `partials` | object | | HTML for `{% render 'name' %}`, by name. Without it, snippets load from the library. See [Snippets](/guides/templates-and-liquid/#snippets). |
| `subject` | string | | Who the document is about (an email, a customer number), for erasure. See [Personal data](/guides/personal-data/#tag-generations-with-a-subject). |

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

Request bodies are limited to 20 MB. Every render is logged in the [generation log](/guides/generation-log/) with source `api` and the key's name.

## Responses

| Status | When | Body |
| --- | --- | --- |
| `200` | Rendered, `response: "pdf"` | The PDF (`application/pdf`), with `X-Generation-Id` and `X-Page-Count` |
| `200` | Rendered, `response: "json"` | `{ generationId, status, filename, pageCount, size, downloadUrl, pdfPath }` |
| `202` | `async: true`, or still queued or running after the wait | `{ "generationId": "...", "status": "queued" \| "running" }` |
| `422` | Invalid body, or a Liquid or render error | `{ error, code, fieldErrors?, generationId? }` |

Key, scope and rate-limit errors (401, 403, 429) are listed in [API keys and errors](/guides/api-keys/#errors).

### JSON instead of bytes

```sh
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"html":"<p>Receipt</p>","response":"json"}' \
  https://necodoc.example.com/api/v1/render
```

```json
{
  "generationId": "986c447f-fc3b-4896-992b-b366e0b5472a",
  "status": "success",
  "filename": "document.pdf",
  "pageCount": 1,
  "size": 3199,
  "downloadUrl": "https://necodoc.example.com/api/files/signed/...",
  "pdfPath": "/api/v1/generations/986c447f-fc3b-4896-992b-b366e0b5472a/pdf"
}
```

`downloadUrl` is a signed link that works without a key for an hour: hand it to a browser or another system. `pdfPath` works with a key for as long as the generation exists.

### Synchronous and async

Renders run as jobs on a worker. A synchronous call waits for the job, up to `RENDER_WAIT_MS` (30 seconds by default), and returns the PDF. Past that it answers `202` with the generation id; the render continues. With `async: true` it answers `202` straight away.

```sh
curl -H "x-api-key: $NECODOC_API_KEY" -H 'Content-Type: application/json' \
  -d '{"html":"<p>Big report</p>","async":true}' \
  https://necodoc.example.com/api/v1/render
# {"generationId":"83c63266-...","status":"queued"}
```

## Fetching a result later

Poll the generation (scope `generations:read`), then download its PDF:

```sh
curl -H "x-api-key: $NECODOC_API_KEY" https://necodoc.example.com/api/v1/generations/$ID
curl -H "x-api-key: $NECODOC_API_KEY" -o out.pdf https://necodoc.example.com/api/v1/generations/$ID/pdf
```

`GET /api/v1/generations/:id` returns the entry, including `status` (`queued`, `running`, `success`, `error`, `cancelled`), `error`, `pageCount`, `size` and `hasOutput`. The PDF is served inline, or as an attachment with `?download=1`, with ETags and range requests. `POST /api/v1/generations/:id/link` mints a signed link, valid for an hour unless the body sets `expiresInSeconds` (60 seconds to 7 days).

A key reads only its owner's generations. To be told when a render finishes instead of polling, use a [webhook](/guides/webhooks/).

## What the renderer allows

- **No network.** Remote URLs in the HTML don't load. Use [assets](/guides/themes-and-assets/#assets) via the `asset_url` filter, or `data:` URLs.
- **No JavaScript.** Pages render with JavaScript disabled.
- **Liquid is escaped by default.** `{{ value }}` is HTML-escaped; use `{{ value | raw }}` to output trusted HTML. Unknown filters are errors. See [Liquid](/guides/templates-and-liquid/#liquid).
- **Timeout.** A render that takes longer than 30 seconds fails.
- **Fonts.** Noto Sans is the default. Noto Serif, Inter and JetBrains Mono are bundled; other fonts come from uploaded font assets through a theme or `@font-face` in your CSS.

## Templates instead of HTML

To render a published template with validated data, `POST /api/v1/templates/:id/versions/:version/generate` with `{ data, filename?, output?, response?, async?, signing?, subject? }` (scope `templates:generate`). `GET /api/v1/templates/:id/versions/:version/schema` returns the JSON Schema the data must match. See [Generating from a template](/guides/templates-and-liquid/#generating-from-a-template).

## Combining PDFs

`POST /api/v1/combine` (scope `combine:write`) merges your generations and uploaded PDFs, in order, into one PDF. Each input's form is flattened first. It answers like render.

```json
{
  "inputs": [
    { "generationId": "65c2e1f9-25e5-4d52-b877-38650cbd09c2" },
    { "pdf": "JVBERi0xLjcK..." }
  ],
  "filename": "closing-binder",
  "response": "json"
}
```

`pdf` is the file base64-encoded (`base64 -i cover.pdf`). Encrypted PDFs can't be combined. Up to 100 inputs, within the 20 MB body limit.
