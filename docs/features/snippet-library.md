---
type: feature
title: Snippet library
description: Reusable named content blocks (clauses, disclaimers, signature blocks) that designed templates and API HTML include by name; published versions snapshot them.
tags: [product, editor, app]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Snippet library

## Summary

A snippet is a named block of content, written once and included in many
templates: a confidentiality clause, a company address, a signature block.

## Motivation

The same paragraph pasted into thirty templates gets fixed in twelve of them.
GhostDraft's clause library is a core reason legal and insurance teams buy it.

## Behavior

- A snippet has a unique name, a description, and content edited in the same
  rich-text editor as [document templates](document-templates.md) (or in code
  mode).
- Snippets can use merge fields. A snippet lists the field keys it expects;
  inserting it into a template that lacks one of them flags the missing field.
- **Use.** Insert from the editor's snippet picker. It compiles to
  `{% render 'name' %}`
  ([ADR 0015](../adrs/0015-liquidjs-for-templating.md)).
  [API HTML](html-to-pdf-api.md) can use the same tag.
- Snippets can include other snippets. Cycles are rejected on save.
- **Versions.** Publishing a template snapshots the snippets it uses
  ([Publishing and versions](publishing-and-versions.md)). Editing a snippet
  lists the templates whose published versions use an older copy, so an editor
  can republish them.
- Snippets can't be renamed while a draft uses them, and can't be deleted
  while any template uses them.
- Needs `document: create` / `document: edit`.

## Acceptance criteria

- [ ] An editor can create a snippet with a merge field and include it in two
      templates.
- [ ] Editing the snippet changes both drafts' previews but neither published
      version.
- [ ] The snippet page lists every template using it, and which are out of
      date.
- [ ] A snippet cycle is rejected with the cycle shown.
- [ ] An API render with `{% render 'name' %}` includes the snippet.

## Known limitations

- Snippets are global; no folders or permissions per snippet.
- No bulk "republish everything using this snippet".
- Snippets don't work in overlay templates.
