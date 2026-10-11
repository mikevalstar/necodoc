---
title: Themes and assets
description: Theme settings and built-in starters, the asset library, fonts, and how rendered pages load images.
sidebar:
  order: 4
---

## Themes

A theme styles the body and bands of a template, and of [HTML renders](/guides/html-to-pdf/) that pass `themeId`.

Settings:

| Setting | Notes |
| --- | --- |
| `font`, `headingFont` | A bundled font id or `{ "assetId": "..." }` for an uploaded font |
| `fontSize`, `h1Size`, `h2Size`, `h3Size` | Points, 4 to 96 |
| `lineHeight` | 0.8 to 3 |
| `textColor`, `headingColor`, `linkColor`, `accentColor` | `#rrggbb`. The accent colours `<hr>`. |
| `tableBorderColor`, `tableHeaderBackground` | `#rrggbb` |
| `tableCellPadding` | Millimetres, 0 to 20 |

A theme also has free **CSS**, appended after the settings. CSS cascades in this order: bundled fonts and base styles, theme settings, theme CSS, then the template's CSS (or the request's `css`).

**Built-in starters**: Plain (Noto Sans), Formal serif (Noto Serif, justified paragraphs) and Modern sans (Inter). They can't be edited or deleted; copy one and adjust it.

When a template is published, its theme's settings and CSS are copied into the version. Editing the theme later changes drafts and new publishes, not existing versions.

Creating a theme needs `document: create`; editing or deleting one needs `document: edit`. The theme editor previews a sample document as you edit, without logging a generation.

Routes (internal API): `GET /api/themes`, `GET /api/themes/:id`, `POST /api/themes`, `PATCH /api/themes/:id`, `DELETE /api/themes/:id`.

## Fonts

Bundled, open-licence fonts, usable by id in a theme:

| Id | Family |
| --- | --- |
| `noto-sans` | Noto Sans (the default) |
| `inter` | Inter |
| `noto-serif` | Noto Serif |
| `jetbrains-mono` | JetBrains Mono |

They come in regular and bold, with italics except JetBrains Mono. Any other font is an uploaded font asset. If a theme's font asset is deleted, text falls back to Noto Sans.

## Assets

Rendered pages can't reach the network, so images and fonts come from the asset library.

- **Types:** PNG, JPEG, SVG and WebP images; TTF, OTF and WOFF2 fonts. The API checks a file's real type, not its extension.
- **Size:** up to 20 MB each.
- **Uploading** needs `document: create`. Everyone with `document: view` can use assets.
- Assets are global to the install: there are no per-user or per-folder assets.

Reference an asset by id with the `asset_url` filter, so renaming it doesn't break anything:

```liquid
<img src="{{ 'ASSET-ID' | asset_url }}" alt="Logo">
```

In CSS, use the URL the filter produces, `https://assets.necodoc.invalid/<asset id>`. That origin never resolves on a real network; the renderer serves it from necodoc's storage.

```css
@font-face { font-family: "Brand"; src: url(https://assets.necodoc.invalid/ASSET-ID); }
h1 { font-family: "Brand", sans-serif; }
```

`data:` URLs also work, which is how image and signature fields reach the page.

Internal API: `GET /api/assets` (with `?q=` and `?kind=image|font`), `POST /api/assets` (multipart with `file` and an optional `name`), `GET /api/assets/:id/file`, `PATCH /api/assets/:id` to rename, `DELETE /api/assets/:id`.
