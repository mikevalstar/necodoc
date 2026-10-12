---
type: feature
title: Snippet library
description: Reusable named content blocks (clauses, disclaimers, signature blocks) that designed templates and API HTML include by key; published versions snapshot them.
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

- A snippet has a name, a unique key (lowercase, set once at creation), a
  description, tags, and content edited in the same rich-text editor as
  [document templates](document-templates.md), or as HTML/Liquid in code mode.
  Visual snippets can become code snippets, not back.
- **Fields.** Snippets use merge fields like a template does. A snippet lists
  the field keys it expects; its editor offers only those. A template using a
  snippet that expects a field the template doesn't declare gets that flagged
  with its other field problems.
- **Use.** The visual editor's Insert menu and `/` menu add a snippet block,
  shown with the snippet's name and a preview of its text. It references the
  snippet by id and compiles to `{% render '<id>' %}`. Code-mode templates and
  [API HTML](html-to-pdf-api.md) write `{% render 'key' %}`
  ([ADR 0015](../adrs/0015-liquidjs-for-templating.md)). A snippet sees the
  document's top-level fields.
- Snippets can include other snippets. Saving a snippet that would make a cycle,
  or that includes a snippet that doesn't exist, is refused with the reason.
- **Versions.** Drafts, previews and API HTML use each snippet's current
  content. Publishing a template snapshots the HTML of every snippet it uses
  into the version ([Publishing and versions](publishing-and-versions.md)), so
  later snippet edits don't change it. A snippet's page lists the templates
  that use it and flags those whose latest published version has an older copy,
  with a link to republish.
- Archived snippets disappear from the pickers but keep rendering where they
  are used. A snippet can't be deleted while a template draft or another
  snippet uses it; published versions have their own copy.
- Needs `document: create` to create, `document: edit` to change, archive and
  delete; anyone who can open drafts can list and view snippets.
- API: [routes/snippets.ts](../../apps/api/src/routes/snippets.ts); render
  loading: [snippets.ts](../../apps/api/src/snippets.ts) (checks in [render/partials.ts](../../apps/api/src/render/partials.ts)); schemas:
  [snippet.ts](../../packages/shared/src/snippet.ts).

## Acceptance criteria

- [x] An editor can create a snippet with a merge field and include it in two
      templates.
- [x] Editing the snippet changes both drafts' previews but neither published
      version.
- [x] The snippet page lists every template using it, and which are out of
      date.
- [x] A snippet cycle is rejected with the cycle shown.
- [x] An API render with `{% render 'name' %}` includes the snippet.

## Known limitations

- Snippets are global; no folders or permissions per snippet.
- No bulk "republish everything using this snippet".
- Snippets don't work in overlay templates.
- Inside a repeating section a snippet still sees only top-level fields, not
  the repeat item; code mode can pass it: `{% render 'key', item: item %}`.
- Expected fields are checked one level deep: a snippet's included snippets
  aren't checked against the template.
- Converting a visual template to code mode keeps snippet blocks as
  `{% render '<id>' %}`.
- Partial names must be literal strings; `{% render variable %}` isn't
  resolved.
