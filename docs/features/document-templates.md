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
  - repeating section: repeated per item of a repeating group. A table row
    can repeat the same way. Leading rows made only of header cells are the
    header rows.
  - raw HTML / Liquid block: hand-written markup output verbatim, for what the
    other blocks can't express, without converting the template to code mode
    ([ADR 0024](../adrs/0024-codemirror-6-for-code-mode-and-raw-html-blocks.md))
  - [snippet](snippet-library.md) reference
- The node set is fixed by a shared schema
  ([template-doc.ts](../../packages/shared/src/template-doc.ts)) and compiled by
  [compile.ts](../../packages/shared/src/compile.ts). Nodes or marks outside it
  are rejected on save. Typed text never becomes Liquid or HTML.
- Merge field filters are a fixed list: date format, number, currency,
  upper/lower/capitalised case, and keep line breaks.
- Merge fields and conditions pick from the template's declared
  [fields](template-fields-and-guided-form.md). An expression that references
  an undeclared field is flagged in the editor
  (`templateFieldProblems` in [compile.ts](../../packages/shared/src/compile.ts)).
- **Theme.** The editor picks a [document theme](document-themes.md). It
  styles body and bands.
- **Live preview.** A side panel shows the PDF rendered from the current draft
  (saved or not) and the template's sample data. It re-renders shortly after
  edits stop. A render error shows the Liquid or render message instead of a
  blank pane.
- **Code mode.** An editor can convert a template to raw HTML/Liquid for full
  control, edited in a code editor with field and filter completion
  ([ADR 0024](../adrs/0024-codemirror-6-for-code-mode-and-raw-html-blocks.md)).
  Converting is one-way; the app warns first and offers to duplicate the
  template as a code copy instead.
- **Template CSS.** Each template can add CSS after its theme, in either mode.
  It styles the body and both bands.
- **Editor.** [Template pages](../../apps/app/src/routes/_app/templates/),
  the [rich-text editor](../../apps/app/src/components/editor/doc-editor.tsx)
  and the [code editor](../../apps/app/src/components/code-editor.tsx). Edits
  are saved explicitly; leaving with unsaved changes asks first.
- **AI drafting** (when enabled,
  [ADR 0018](../adrs/0018-claude-api-for-ai-field-detection-and-drafting.md)).
  The editor describes the content they want; the suggestion uses only declared
  fields and is inserted only on accept.
- Templates are drafts until published
  ([Publishing and versions](publishing-and-versions.md)). API:
  [routes/templates.ts](../../apps/api/src/routes/templates.ts).

## Acceptance criteria

- [x] An editor can create a template, set page size, orientation and margins,
      and see them in the preview.
- [x] Header and footer render on every page with full HTML (an image and a
      table work), and `{{ page }} of {{ pages }}` shows correct numbers.
- [x] A first-page header variant appears on page 1 only.
- [x] Body content never overlaps a band.
- [x] A repeating section with 200 items paginates cleanly; table header rows
      repeat on each page.
- [x] A conditional section disappears when its condition is false.
- [x] A manual page break starts a new page.
- [x] The preview updates after an edit without a manual refresh.
- [x] A raw HTML / Liquid block renders its markup and Liquid as written.
- [x] Template CSS applies after the theme, in the body and the bands.
- [x] A template converted to code mode renders the same PDF as before
      conversion.
- [x] `<script>` in a template doesn't run, and a remote image URL doesn't load
      (the render still succeeds).

## Known limitations

- Band content taller than the band height is clipped.
- A first-page band variant has the same height as the band, so a tall letterhead
  on page 1 means the same reserved space on every page.
- The editor shows content, not pages. Page layout is only visible in the
  preview.
- Code mode can't convert back to the visual editor.
- Raw HTML blocks and code mode aren't checked against the declared fields;
  only their Liquid syntax is checked, at publish.
- A choice merge field prints the option's value, not its label.
- Template CSS can't tell the header from the footer: both are `.necodoc-band`.
- Repeating sections don't nest (repeating groups don't either).
- Table column widths set in the editor aren't carried into the PDF; columns
  size to their content.
- No JavaScript in templates, so no client-side charts.
- No footnotes, columns that balance across pages, or per-section page sizes.

## Open questions

- Do we need per-section headers (e.g. a different header from page 5 on)?
