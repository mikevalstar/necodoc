---
type: feature
title: Document templates
description: Editors design a document from scratch in a rich-text editor (body, header and footer bands, merge fields, conditions, repeats, tables, images, page breaks) and see a live PDF preview with sample data.
tags: [product, pdf, app, editor]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Document templates

## Summary

An editor builds a document from scratch: letters, contracts, quotes,
certificates. Content flows across as many pages as the data needs, with real
HTML headers and footers on every page. The preview is the actual PDF.

## Motivation

Many documents don't exist as a PDF yet, or the PDF that exists is a dead
export from Word. Content that grows with the data (a list of line items, an
optional clause) can't live in fixed boxes. GhostDraft does this inside Word;
DocSpring and Anvil make you write HTML. necodoc gives non-developers a visual
editor and developers a code mode, on one renderer.

## Behavior

- **Page setup.** Letter, A4 or Legal, portrait or landscape. Margins on all
  four sides.
- **Bands.** A header and a footer, each its own rich-text document with a
  height the editor sets. Each can have a first-page variant (a letterhead on
  page 1, a slim header after). Bands can use `{{ page }}` and `{{ pages }}`,
  merge fields and images. Mechanism:
  [ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md).
- **Body.** Flowing rich text that paginates to fit its content: headings,
  paragraphs, lists, tables (rows may break across pages; header rows repeat),
  images from [assets](assets.md), and manual page breaks.
- **Structure nodes**
  ([ADR 0016](../adrs/0016-tiptap-for-the-document-editor.md)):
  - merge field: inserts a field value, with an optional filter (date format,
    currency)
  - conditional section: shown only when a condition on the fields holds
  - repeating section: repeated per item of a repeating group, including
    table rows
  - [snippet](snippet-library.md) reference
- Merge fields and conditions pick from the template's declared
  [fields](template-fields-and-guided-form.md). An expression that references
  an undeclared field is flagged in the editor.
- **Theme.** The editor picks a [document theme](document-themes.md). It
  styles body and bands.
- **Live preview.** A side panel shows the PDF rendered from the current draft
  and the template's sample data. It re-renders shortly after edits stop. A
  render error shows the Liquid or render message instead of a blank pane.
- **Code mode.** An editor can convert a template to raw HTML/Liquid for full
  control. Converting is one-way; the app warns first.
- **AI drafting** (when enabled,
  [ADR 0018](../adrs/0018-claude-api-for-ai-field-detection-and-drafting.md)).
  The editor describes the content they want; the suggestion uses only declared
  fields and is inserted only on accept.
- Templates are drafts until published
  ([Publishing and versions](publishing-and-versions.md)).

## Acceptance criteria

- [ ] An editor can create a template, set page size, orientation and margins,
      and see them in the preview.
- [ ] Header and footer render on every page with full HTML (an image and a
      table work), and `{{ page }} of {{ pages }}` shows correct numbers.
- [ ] A first-page header variant appears on page 1 only.
- [ ] Body content never overlaps a band.
- [ ] A repeating section with 200 items paginates cleanly; table header rows
      repeat on each page.
- [ ] A conditional section disappears when its condition is false.
- [ ] A manual page break starts a new page.
- [ ] The preview updates after an edit without a manual refresh.
- [ ] A template converted to code mode renders the same PDF as before
      conversion.
- [ ] `<script>` in a template doesn't run, and a remote image URL doesn't load
      (the render still succeeds).

## Known limitations

- Band content taller than the band height is clipped.
- A first-page band variant has the same height as the band, so a tall letterhead
  on page 1 means the same reserved space on every page.
- The editor shows content, not pages. Page layout is only visible in the
  preview.
- Code mode can't convert back to the visual editor.
- No JavaScript in templates, so no client-side charts.
- No footnotes, columns that balance across pages, or per-section page sizes.

## Open questions

- Do we need per-section headers (e.g. a different header from page 5 on)?
