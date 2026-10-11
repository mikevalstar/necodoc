---
type: adr
title: CodeMirror 6 for code mode and raw HTML blocks
description: Hand-written HTML/Liquid and template CSS are edited in CodeMirror 6 with its Liquid mode; visual templates get a rawHtml block for advanced markup, and template CSS lives in the template content.
tags: [architecture, app, frontend, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T17:03:38Z }
---

# CodeMirror 6 for code mode and raw HTML blocks

## Status

Accepted. Extends [ADR 0016](0016-tiptap-for-the-document-editor.md).

## Context

Advanced users write HTML and Liquid by hand: [code mode](../features/document-templates.md),
template CSS, and markup the visual editor's blocks can't express (a signature layout, a QR
code). A textarea gives no highlighting, no search and no help with field names. Converting a
whole template to code mode for one advanced block is one way
([ADR 0016](0016-tiptap-for-the-document-editor.md)) and loses the visual editor for everything
else.

## Decision

- **CodeMirror 6** (`codemirror` + `@codemirror/lang-liquid`, which embeds HTML, and
  `@codemirror/lang-css`) for every hand-written code field: code-mode body and bands, raw HTML
  blocks and template CSS. One small wrapper,
  [code-editor.tsx](../../apps/app/src/components/code-editor.tsx). Its Liquid mode completes
  the template's field paths and necodoc's filters
  ([ADR 0015](0015-liquidjs-for-templating.md)). Chosen over `@uiw/react-codemirror`: the wrapper
  we need is a few lines, and the official Liquid mode does the rest.
- **A `rawHtml` block** in the visual node set
  ([template-doc.ts](../../packages/shared/src/template-doc.ts)): HTML + Liquid output verbatim,
  not escaped. Renders run without JavaScript or network
  ([ADR 0012](0012-headless-chromium-for-html-to-pdf.md)), and publish checks the Liquid
  parses, so verbatim markup can't do more than code mode already can.
- **Template CSS** is a `css` string in the template content (both modes,
  [template.ts](../../packages/shared/src/template.ts)), compiled into the render request after
  the theme. Living in content avoids a new column and travels with publish snapshots.

## Consequences

- Visual templates can hold advanced markup without converting; code mode stays for those who
  want everything by hand, and "Duplicate as code template" keeps the visual original.
- Raw blocks aren't checked against the declared fields (only Liquid syntax, at publish).
- The app bundle grows by CodeMirror; it loads with the template editor route only.
