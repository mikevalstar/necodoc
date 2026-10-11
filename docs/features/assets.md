---
type: feature
title: Assets
description: Uploaded images and fonts that templates and themes reference; the renderer serves them in-process because rendered pages can't reach the network.
tags: [product, pdf, app]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Assets

## Summary

Editors upload logos, images and fonts once and use them in any template,
band or theme.

## Motivation

Rendered pages can't fetch remote URLs
([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)), so every image
and font must come from necodoc. A shared library also stops ten copies of the
same logo.

## Behavior

- **Types:** PNG, JPEG, SVG and WebP images; TTF, OTF and WOFF2 fonts. Up to
  20 MB each ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)).
  The API checks the file's real type, not just its extension.
- **Library page.** List, search, preview, rename and delete assets, with
  name, type, size and uploader.
- **Use.** The editors insert assets from a picker. Templates reference them by
  id through the `asset_url` filter
  ([ADR 0015](../adrs/0015-liquidjs-for-templating.md)), so renaming is safe.
  Fonts are referenced from [themes](document-themes.md) and overlay boxes. Free CSS
  can point at an asset directly as `https://assets.necodoc.invalid/<asset id>`, the
  renderer's in-process origin ([render.ts](../../packages/shared/src/render.ts)).
- **Overlay limits.** [Overlay templates](pdf-overlay-templates.md) can use
  PNG/JPEG images and TTF/OTF fonts only
  ([ADR 0013](../adrs/0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
- **API.** `/api/v1` can upload assets and return their ids, for use in
  [API renders](html-to-pdf-api.md).
- Assets are immutable. "Replace" uploads a new asset and points the current
  draft at it; published versions keep the old one.
- An asset used by a published version can't be deleted. The app lists where
  it's used.
- Uploading needs `document: create`; every user with `document: view` can
  use assets in API renders.

## Acceptance criteria

- [ ] An editor can upload an image and a font and use both in a template.
- [x] A file whose content doesn't match an allowed type is rejected.
- [ ] Renaming an asset doesn't break templates using it.
- [ ] Deleting an asset used by a published version is refused, with the list
      of users of it.
- [ ] An API render can reference an asset uploaded through the API.

## Known limitations

- Assets are global. No per-user or per-folder privacy.
- SVGs render in designed templates only, not overlays.
- No image editing (crop, resize) in the app.
- Deleting a font asset a theme uses isn't refused; the theme falls back to Noto Sans.
