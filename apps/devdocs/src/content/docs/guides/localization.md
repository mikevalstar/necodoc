---
title: Localization
description: Make one template's documents in many languages, with locale-aware dates, numbers and money, translated text, and right-to-left layout.
sidebar:
  order: 10
---

Every render has one **document language**, a BCP 47 tag in `output.lang` (default `en`). It decides:

- how `date`, `number` and `currency` format (unless a filter is given its own locale);
- which translations `t` and the guided form use;
- the text direction: Arabic, Hebrew, Persian, Urdu and other right-to-left languages get `dir="rtl"` on the body, header and footer;
- the language the PDF declares (the `/Lang` screen readers and PDF/UA use).

## Pick the language per request

A template's own language is set in the editor (Output tab). Override it per PDF:

```bash
curl -X POST "$NECODOC/api/v1/templates/$TEMPLATE/versions/latest/generate" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"data":{"total":1234.5,"due":"2026-11-30"},"output":{"lang":"fr-CA"}}'
```

`POST /api/v1/render` takes the same `output.lang`, plus optional `translations` for its HTML.

## Translations

Templates are written in their own language and translated in place, so there's one template to maintain. Translations are keyed by the source text:

```json
{
  "fr": { "Invoice": "Facture", "Thank you": "Merci" },
  "fr-CA": { "Invoice": "Facture (Canada)" }
}
```

- A language's table (`fr`) also serves its regional tags (`fr-CA`, `fr-BE`); a regional table overrides single strings.
- Text without a translation prints as written.
- In the editor, the Translations tab lists everything translatable: field labels, help, choices, section titles, visual text, and `"..." | t` in code mode and overlay boxes.
- In code mode, wrap text: `{{ "Thank you" | t }}`. `{{ status | t }}` translates a value.
- Visual text is translated automatically once the template has a translation, run by run: bold words and merge fields split a sentence into separate strings.

The fill page and share links show a language picker when a template has translations. A share link takes `?lang=fr`; otherwise it follows the browser's language.

## Fonts

Arabic and Hebrew render with bundled Noto Sans Arabic and Noto Sans Hebrew whatever the theme font. Chinese, Japanese and Korean use the server's fonts: the container image ships IPAGothic and WenQuanYi Zen Hei. For a particular face, upload the font and use it in a theme.

## Limitations

- Overlay templates draw text with pdf-lib, which doesn't shape or reorder right-to-left text: Arabic and Hebrew don't render correctly in overlay boxes.
- No plural rules or placeholders inside translations; use Liquid (`replace`, `if`) around them.
- Validation messages stay in English.
