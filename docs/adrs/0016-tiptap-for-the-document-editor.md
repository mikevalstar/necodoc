---
type: adr
title: TipTap for the document editor
description: Designed templates are edited in TipTap (ProseMirror) with custom nodes for merge fields, conditions, repeats and page breaks; TipTap JSON is the source of truth and compiles to HTML plus Liquid. A raw code mode also exists.
tags: [architecture, app, frontend, pdf]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# TipTap for the document editor

## Status

Accepted. Builds on
[ADR 0004](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md).

## Context

[Document templates](../features/document-templates.md) are written by people
who know Word, not HTML. They need rich text, tables and images, plus
structure Word lacks: merge fields, conditional sections, repeating sections
and page breaks, each tied to the template's
[fields](../features/template-fields-and-guided-form.md). Body, header and
footer are three separate documents
([ADR 0012](0012-headless-chromium-for-html-to-pdf.md)).

## Decision

- Use **TipTap** (on ProseMirror) for the body, header and footer editors. Use
  only its MIT-licensed open-source extensions, no paid Pro ones.
- **Custom nodes:**
  - merge field: inline, an expression over the template's fields
  - conditional section: block, shown when a condition holds
  - repeating section: block, repeated per item of a repeating group
  - page break
  - snippet reference ([Snippet library](../features/snippet-library.md))
  - tables and images (asset-backed) use TipTap's extensions
- **TipTap JSON is the stored source of truth** for visual templates. A
  compiler in `packages/shared` turns it into HTML plus Liquid
  ([ADR 0015](0015-liquidjs-for-templating.md)): a merge field becomes
  `{{ ... }}`, a conditional `{% if %}`, a repeat `{% for %}`. The API compiles
  on render; the app compiles for code mode. This widens `packages/shared`
  from schemas to logic both sides run; the browser-safe rule of
  [ADR 0008](0008-zod-schemas-shared-between-api-and-app.md) still holds, so
  the compiler works on plain JSON and imports nothing from TipTap's runtime.
- **Code mode** is a raw HTML/Liquid editor. A template switches from visual to
  code once, by compiling. It can't switch back, because arbitrary HTML doesn't
  map onto the node schema.

## Alternatives considered

- **Lexical.** Good React integration, but fewer ready-made extensions (tables
  especially) and less precedent for custom block nodes with attributes.
- **Store HTML and parse it back.** Liquid tags inside HTML don't survive a
  round trip through a rich-text parser.

## Consequences

- Editors can't type broken Liquid in visual mode; the node schema only allows
  valid structures.
- The compiler is the contract between editor and renderer and needs thorough
  tests.
- Code mode is one-way. The UI must warn before converting.
- WYSIWYG is approximate. The editor shows content, not pages; the PDF preview
  shows the layout.
