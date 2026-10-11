---
type: feature
title: Document themes
description: Reusable named CSS themes (typography, colours, headings, tables, plus free CSS) with built-in starters and bundled fonts, applied to designed templates and API renders.
tags: [product, pdf, app, editor]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Document themes

## Summary

A theme is a named set of document styles. Editors pick one per template;
API callers pick one per render. Changing the house style means editing one
theme, not every template.

Not to be confused with the app's light/dark setting in
[User preferences](user-preferences.md).

## Motivation

Organisations want every document to look the same. Without themes, each
template carries its own CSS and they drift apart.

## Behavior

- **Settings:** base font, size and line height; text and accent colours;
  heading fonts and sizes; table borders, header shading and cell padding;
  link colour.
- **Free CSS** appended after the settings, for anything the settings don't
  cover.
- **Built-in starters** (for example plain, formal serif, modern sans) that
  editors copy and adjust. Starters themselves can't be edited.
- **Fonts.** A few bundled open-licence fonts (sans, serif, mono), plus
  uploaded font [assets](assets.md).
- **Where themes apply.** Body and bands of
  [designed templates](document-templates.md), and [API](html-to-pdf-api.md) renders
  that name a theme. Overlay templates don't use themes.
- **Preview.** The theme editor shows a sample document rendered with the
  theme as it's edited, without logging a generation
  ([theme editor](../../apps/app/src/routes/_app/themes/$id.tsx)).
- Publishing a template snapshots its theme's CSS
  ([Publishing and versions](publishing-and-versions.md)). Editing a theme
  shows which published templates use an older copy.
- Creating and editing themes needs `document: create` / `document: edit`
  ([roles](user-management-and-roles.md)).

## Acceptance criteria

- [x] An editor can create a theme from a starter, change its settings and free
      CSS, and see the sample update.
- [ ] A template using the theme renders with its fonts and colours in body
      and bands.
- [ ] An API render with a theme id applies that theme.
- [ ] Editing a theme doesn't change an already published version.
- [x] A theme using an uploaded font renders that font in the PDF.

## Known limitations

- Free CSS is unrestricted, so it can break layout. The preview is the check.
- Remote `@import` and font URLs don't load
  ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)).
- An uploaded font is one file, so bold and italic are synthesised by Chromium.
- Built-in starters are defined in [builtin-themes.ts](../../apps/api/src/builtin-themes.ts)
  and re-seeded on every API boot.
