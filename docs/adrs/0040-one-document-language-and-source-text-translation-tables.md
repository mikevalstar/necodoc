---
type: adr
title: One document language and source-text translation tables
description: The existing output.lang tag is the one document language; it drives Liquid date, number and currency formatting (dayjs locales, Intl), text direction, the HTML and PDF language, and picks a translation table. Translations are per-locale tables keyed by the template's own source text, stored in template content and looked up with a `t` filter; Noto Sans Arabic and Hebrew are bundled, CJK uses the system fonts.
tags: [architecture, pdf, templates]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T06:32:35Z }
---

# One document language and source-text translation tables

## Status

Accepted. Behaviour: [Document localization](../features/document-localization.md).
Builds on [ADR 0015](0015-liquidjs-for-templating.md) (Liquid filters),
[ADR 0016](0016-tiptap-for-the-document-editor.md)
(visual compile) and [ADR 0037](0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md)
(the PDF `/Lang` already comes from `output.lang`).

## Context

Insurers, banks and governments send the same document in several languages
(English and French in Canada, Spanish in the US, Arabic in the Gulf). The
competitors handle this by copying the template once per language
(GhostDraft, DocSpring, Anvil), so every fix is made N times and the copies
drift. We need: locale-aware dates, numbers and money; translated static text
and form labels without copying the template; right-to-left layout; fonts for
scripts Noto Sans doesn't cover.

Options considered for the language setting:

- **A new `locale` field** next to `output.lang`. Two tags that can disagree:
  a French-formatted PDF that tells screen readers it's English.
- **`output.lang` as the one document language.** Already per template, per
  request override, frozen in versions, and written to `<html lang>` and the
  PDF catalog. It becomes the locale too.

Options for translated text:

- **Locale variants of the whole content.** Each variant is a full copy of the
  body, so it drifts exactly like copied templates; the editor has to manage N
  documents.
- **Keyed string tables** (`{{ "invoice.title" | t }}`). Authors invent keys and
  maintain a default-language table too; the template reads as keys.
- **Tables keyed by source text** (gettext style:
  `{{ "Invoice" | t }}`). The template stays readable in its own language, a
  missing translation falls back to the source, and the same lookup translates
  field labels, help and choice labels with no schema change to fields.

## Decision

- **`output.lang` is the document language** (BCP 47). It's now kept in
  compiled versions whenever it isn't `en`, and shown in the Output tab for
  every template, not only with PDF/UA on. Requests override it with
  `output.lang`, as before.
- **Formatting follows it.** Each render builds its Liquid engine with the
  language ([liquid.ts](../../apps/api/src/render/liquid.ts)): `date` formats
  with the matching dayjs locale (`fr-ca`, then `fr`, then `en`) and defaults
  to the localized `LL`; `number` and `currency` use `Intl` with the language.
  An explicit locale argument still wins.
- **Translations are `content.translations`**: `{ "<lang>": { "<source text>":
  "<translation>" } }`, in content like signers and output settings, so
  versions, fingerprints and diffs cover them with no new column. The `t`
  filter looks the text up for the request's language: the language's table
  (`fr`) merged under the exact tag's (`fr-CA`), otherwise the source text.
  Helpers live in [locale.ts](../../packages/shared/src/locale.ts).
- **Visual templates** can't type Liquid, so when a template has any
  translations, the compiler wraps each static text run in `t`. Templates
  without translations compile exactly as before.
- **Direction** comes from the language (Arabic, Hebrew, Persian, Urdu and
  other RTL languages, or an `Arab`/`Hebr` script subtag): `<html dir="rtl">`
  on body and bands, and table cells align to `start`.
- **Fonts.** Fontsource's Noto Sans Arabic and Noto Sans Hebrew are bundled
  and added after every theme font, before the generic family; Chromium only
  loads them for glyphs the primary font lacks, which can be after `load`, so
  [browser.ts](../../apps/api/src/render/browser.ts) waits for
  `document.fonts.ready` before printing. CJK is not bundled (tens of MB
  per script): the container's Chromium dependencies install IPAGothic and
  WenQuanYi Zen Hei, and a theme can upload any font as an asset.

## Consequences

- One template serves every language; fixing it once fixes all of them.
- Translators work on fragments in visual templates: a sentence with bold or a
  merge field in the middle is split into separate strings. Code mode lets
  authors wrap whole sentences.
- Translations are only as fresh as their source text: editing a sentence
  orphans its translation, which then falls back to the new source. The
  editor lists strings without a translation.
- Overlays (pdf-lib) draw text without shaping or bidi, so Arabic and Hebrew
  in overlay boxes don't render correctly; formatting and `t` work there.
- Validation messages and the app's own UI stay English.
