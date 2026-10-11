---
title: Templates and Liquid
description: Template fields and the guided form, the Liquid language with necodoc's filters, publishing, and generating from a template.
sidebar:
  order: 2
---

## Templates

A designed template has:

- **Page setup**: Letter, A4 or Legal; portrait or landscape; margins in millimetres.
- **Body**: flowing rich text that paginates. Headings, paragraphs, lists, tables (header rows repeat on each page), images from [assets](/guides/themes-and-assets/#assets), and page breaks.
- **Header and footer**: optional bands, each with a height and an optional first-page variant. See [Headers, footers and page tokens](/guides/headers-footers/).
- **Theme** and **template CSS**, applied to body and bands. Template CSS comes after the theme.
- **Fields** and **sample data** for previews.

The visual editor has blocks for template logic:

- **Merge field**: a field's value, with an optional filter: date format, number, currency, upper case, lower case, capitalised, or keep line breaks.
- **Conditional section**: shown only when a condition on the fields holds.
- **Repeating section**: repeated once per item of a repeating group. A table row can repeat the same way.
- **Raw HTML / Liquid block**: hand-written markup, output as is.

Text you type in the visual editor never becomes Liquid or HTML. To write the whole template by hand, convert it to **code mode**: the body and bands become HTML and Liquid in a code editor. The conversion is one-way; duplicating the template first keeps a visual copy.

## Fields and the guided form

Fields are ordered and grouped into sections. The guided form shows one section per step.

| Type | Value | Validation |
| --- | --- | --- |
| `text`, `long_text` | string | `minLength`, `maxLength`, `pattern` (a JavaScript regular expression the whole value must match) |
| `number` | number | `min`, `max`, `decimals` (most decimal places; 0 for whole numbers) |
| `date` | ISO date (`YYYY-MM-DD`) | `min`, `max` |
| `boolean` | `true` / `false` | |
| `choice` | option value, or a list of them with `multiple` | `minItems`, `maxItems` (multiple only) |
| `email` | string | must be an email address |
| `image` | `data:` URL (PNG, JPEG or WebP) | |
| `signature` | PNG `data:` URL of a drawn signature | |
| `group` | list of items, each with its own child fields | `minItems`, `maxItems` |

Every field has a `key` (snake_case, unique within the template), a `label`, optional `help`, `required`, and an optional `default`. The keys `page`, `pages`, `item` and `forloop` are reserved. Groups don't nest.

**Show-if conditions.** A field or section can have one rule on an earlier field: `equals`, `not_equals`, `one_of`, `is_set`, `gt` or `lt`. Inside a group, a rule refers to an earlier sibling. Hidden fields are never required and their values are dropped from the data. On a multiple choice field, `equals` means "includes". Empty strings, `false` and empty lists count as not set.

Empty values count as missing, and missing values take the field's default. The same validation runs in the guided form and on every generation. The JSON Schema for a version's data is at `GET /api/templates/:id/versions/:version/schema`.

## Liquid

Templates, bands and HTML renders use [Liquid](https://liquidjs.com/) (LiquidJS) with these settings:

- Output is **HTML-escaped by default**. `{{ value | raw }}` outputs it unescaped; use it only for trusted HTML.
- **Unknown filters are errors**, not silently ignored.
- Only the data's own properties are readable.
- `include` and `render` can't load partials.

The standard LiquidJS tags and filters work (`if`, `unless`, `for`, `assign`, `upcase`, `newline_to_br`, ...), except that `date` is replaced. necodoc adds the filters below. Each one returns an empty string for a missing, `null` or empty value.

### `date`

Formats a date with [dayjs format tokens](https://day.js.org/docs/en/display/format), not strftime. The default format is `MMMM D, YYYY`. `"now"` and `"today"` mean the render time. A value that isn't a date is a render error.

```liquid
{{ due | date }}                  → March 5, 2026
{{ due | date: 'YYYY/MM/DD' }}    → 2026/03/05
{{ 'today' | date: 'D MMM YYYY' }}
```

### `number`

`number: decimals, locale`. Formats with fixed decimals (optional) for a locale (default `en-US`). A value that isn't a number is a render error.

```liquid
{{ 1234.5 | number: 2 }}          → 1,234.50
{{ 1234.5 | number: 2, 'de-DE' }} → 1.234,50
```

### `currency`

`currency: code, locale`. Defaults to `USD` and `en-US`.

```liquid
{{ total | currency }}                 → $1,234.50
{{ total | currency: 'EUR', 'de-DE' }} → 1.234,50 €
```

### `qrcode`

Returns a QR code for the value as an SVG `data:` URL, so it stays vector in the PDF. Use it as an image source.

```liquid
<img src="{{ url | qrcode }}" style="width: 30mm">
```

### `barcode`

`barcode: type`. Returns a barcode as an SVG `data:` URL, with the human-readable text below it. The type is a [bwip-js](https://github.com/metafloor/bwip-js) symbology name; the default is `code128`.

```liquid
<img src="{{ sku | barcode }}">
<img src="{{ isbn | barcode: 'ean13' }}">
```

### `asset_url`

Turns an asset id into the URL the renderer serves it from. See [Assets](/guides/themes-and-assets/#assets).

```liquid
<img src="{{ 'c0ffee00-1234-4abc-8def-000000000000' | asset_url }}">
```

### Data in compiled templates

Visual templates compile to Liquid you can read in code mode. Field values are top-level variables by key. A repeating section over a group compiles to `{% for item in group_key %}`, so a child field is `{{ item.child_key }}`. Conditions compile to `{% if %}` / `{% unless %}`.

## Drafts, versions and publishing

A template has one draft and any number of published versions. Who can do what:

- `document: create`: create templates.
- `document: edit`: change drafts.
- `document: review`: open drafts and their previews read-only.
- `document: publish`: publish, archive and restore.
- `document: view`: list and fill published templates.

Publishing takes an optional change note, and snapshots everything the render needs: content, bands, page setup, fields, the theme's settings and CSS, sample data, and the compiled HTML. It fails if the content doesn't compile or its Liquid doesn't parse. Later edits to the template or theme don't change a published version. Any old version can become the new draft.

Archiving hides a template from the fill list; its versions stay for history and re-runs. A template with published versions can be archived, not deleted.

## Generating from a template

`POST /api/templates/:id/versions/:version/generate`, where `:version` is a number or `latest`. This is the app's session-authenticated API; the API-key version under `/api/v1` is coming.

```json
{ "data": { "client_name": "Ada Lovelace", "start_date": "2026-11-01" }, "filename": "engagement-letter", "async": false }
```

- `data` is validated against the version's fields. Invalid data returns `422` with `{ "error": "Invalid data", "fieldErrors": { "<path>": ["..."] } }`.
- `filename` defaults to the template name.
- Responses match [HTML to PDF](/guides/html-to-pdf/#responses): the PDF, `202` with the generation id, or `422`.
- An archived template answers `409`.

To generate many documents at once, see [Batches and async renders](/guides/batches-and-async/).
