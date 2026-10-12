---
type: feature
title: Document localization
description: One template produces documents in many languages; the document language (per template, per request, or picked by the person filling) drives date, number and currency formatting, translated text and form labels, right-to-left layout and the PDF language.
tags: [product, templates, pdf, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T06:32:35Z }
---

# Document localization

## Summary

A template is written once, in its own language, and translated in place.
Each PDF is made in one document language: dates, numbers and money format
for it, static text and form labels are translated, Arabic and Hebrew lay
out right to left, and the PDF says which language it is.

## Motivation

Bilingual and multilingual customers (Canadian insurers, US carriers with
Spanish forms, Gulf banks) keep one copy of a template per language with the
competitors, and the copies drift. Formatting `1234.5` as `1 234,50 €` or a
date as `12 octobre 2026` shouldn't need a custom filter per template. See
[Competitive scope](competitive-scope.md) and
[ADR 0040](../adrs/0040-one-document-language-and-source-text-translation-tables.md).

## Behavior

- **Document language.** A template's Output tab sets its language (a BCP 47
  tag such as `fr-CA`, default `en`;
  [-output-panel.tsx](../../apps/app/src/routes/_app/templates/-output-panel.tsx)).
  A request overrides it with `output.lang` on template generate, `/api/v1`
  generate and `/api/v1/render` ([HTML to PDF API](html-to-pdf-api.md)). The
  same tag is the PDF/UA language
  ([Archival, accessible and certified output](archival-accessible-and-certified-output.md)).
- **Formatting.** `date`, `number` and `currency` format for the document
  language unless given a locale argument. `date` without a format prints the
  language's long date (`LL`); the visual editor offers the localized formats
  `LL`, `L` and `LLL` next to fixed ones.
- **Translations.** The Translations tab
  ([-translations-panel.tsx](../../apps/app/src/routes/_app/templates/-translations-panel.tsx))
  adds languages and lists every translatable string the template uses: field
  labels, help, placeholders, choice labels, section titles and descriptions,
  visual text, and `"..." | t` in code mode and overlay boxes. Untranslated
  strings fall back to the source text. Translations are content, so they're
  versioned, reviewed and diffed with the template.
  - `{{ "Thank you" | t }}` translates a literal; `{{ status | t }}` translates
    a value, such as a choice.
  - A language's table (`fr`) also serves its regional tags (`fr-CA`); a
    regional table overrides single strings.
- **Filling.** When a published version has translations, the fill page and
  share links offer a language picker
  ([Filling out a document](filling-out-a-document.md),
  [Share links and data requests](share-links-and-data-requests.md)). Labels,
  help and choices show in that language, the form lays out right to left for
  RTL languages, and the PDF is made in it. The document remembers its
  language.
- **Right to left.** RTL languages set `dir="rtl"` on the document and its
  header and footer, so text, lists and tables flow right to left.
- **Fonts.** Arabic and Hebrew render with bundled Noto Sans Arabic and
  Hebrew whatever the theme font. Chinese, Japanese and Korean use the
  server's fonts (the container image ships some); upload a font as a theme
  asset for a specific face ([Document themes](document-themes.md)).
- **Recorded.** Each generation's input keeps its language; the generation
  page shows it ([Generation log](generation-log.md)).
- **AI assistant.** The assistant can propose translations for a language
  ([AI template assistant](ai-template-assistant.md)).

## Acceptance criteria

- [x] `date`, `number` and `currency` format for the document language; an
  explicit locale argument wins
  ([liquid.test.ts](../../apps/api/src/render/liquid.test.ts)).
- [x] Translation lookup: exact tag over language over source text;
  case-insensitive tags ([locale.test.ts](../../packages/shared/src/locale.test.ts)).
- [x] A visual template with translations compiles its text through `t`; one
  without compiles unchanged ([compile.test.ts](../../packages/shared/src/compile.test.ts)).
- [x] One template renders French, German, Arabic (right to left, Arabic
  glyphs) and Japanese PDFs
  ([render.test.ts](../../apps/api/src/render/render.test.ts) for French and
  Arabic; all four checked by eye).
- [x] The fill page shows translated labels and makes the PDF in the picked
  language.

## Open questions

- Plural forms and interpolation inside translations (`replace` covers
  simple cases today).
- Shaping and bidi for overlay text.
