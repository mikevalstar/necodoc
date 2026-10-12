---
type: feature
title: Filling out a document
description: The core product. Editors author templates in-app; users pick a published template, answer its guided form, and get a completed PDF, generated from a designed template or overlaid onto an existing PDF.
tags: [product, pdf, forms, app]
status: draft
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Filling out a document

## Summary

A signed-in user picks a published template, answers a guided form, and
downloads a completed PDF. Similar to GhostDraft, aimed at being simpler to set
up and use. The wider product, and how it compares with GhostDraft, DocSpring
and Anvil, is in [Competitive scope](competitive-scope.md).

## Motivation

Filling in PDFs directly is painful: small fields, no validation, no help, and
the same information typed again and again. A guided form catches mistakes as
they happen, reuses answers, and produces a clean document.

## Terms

- A **template** is what editors author: a
  [designed template](document-templates.md) or a
  [PDF overlay template](pdf-overlay-templates.md), plus its
  [fields](template-fields-and-guided-form.md).
- A **document** is one filled-out instance of a published template version:
  the answers and the PDF made from them.

## Behavior

- **Language.** A template with translations shows a language picker; the
  form and the PDF follow it, and the document remembers it
  ([Document localization](document-localization.md)).
- Editors author templates in the app. Publishers publish them
  ([Publishing and versions](publishing-and-versions.md)).
- Any user with `document: view`
  ([User management and roles](user-management-and-roles.md)) sees published
  templates and picks one.
- The app shows the template's fields as a guided form
  ([ADR 0004](../adrs/0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)),
  validated by the same rules the API applies
  ([ADR 0008](../adrs/0008-zod-schemas-shared-between-api-and-app.md),
  [Template fields and guided form](template-fields-and-guided-form.md)).
- **Documents area** (the app's home page): "My documents" lists the user's
  drafts and finished documents with template, version and last edit; open,
  continue, duplicate or delete each. "New document" opens a picker of
  published, non-archived templates with search, descriptions and a
  first-page thumbnail ([Document templates](document-templates.md)); it shows
  the published name and description, never an unpublished draft's, to
  editors too. "Fill in" on the templates list opens the picker narrowed to
  that template.
- **Get started.** For people who set necodoc up (admins, and anyone who can
  create or publish templates) the home page opens with a checklist: design a
  template, upload a PDF form, publish one, fill in a first document, get an
  API key and, for admins, invite the team. Only steps the user's roles allow
  are listed; each ticks itself off from real data, and the checklist can be
  dismissed (per browser and account). People who only fill documents get an
  empty state pointing to the template picker instead
  ([-get-started.tsx](../../apps/app/src/routes/_app/-get-started.tsx)).
- **Interview.** One section per step with progress, Back and Next, show-if
  and repeating groups, then a review step summarising every answer with a
  way back to each step. Finish validates strictly and generates the PDF.
- **Autosave.** Answers save as the user types, with a visible saved/saving
  state; drafts are checked leniently (unknown keys dropped), so a
  half-finished document survives a reload and reopens on its step. A
  document stays on the template version it was started from.
- **Finish** generates the PDF through the
  [render queue](render-queue-batch-jobs-and-scaling.md), recorded in the
  [generation log](generation-log.md) and linked to the document. The
  document shows a preview and a download; it can be regenerated, or reopened
  for editing (it goes back to draft until finished again).
- **Reuse answers.** A new document can start from a previous one's answers:
  fields with the same key carry over, across templates too. Duplicate does
  the same on the template's latest version.
- Deleting a document keeps its generations in the log.
- API: [routes/submissions.ts](../../apps/api/src/routes/submissions.ts);
  app: [documents](../../apps/app/src/routes/_app/documents/$id.tsx).
- Outside people can fill a template without an account through a
  [share link](share-links-and-data-requests.md).
- Admins can read what has shipped and its limits in the
  [Admin FAQ](admin-faq.md).

## Acceptance criteria

- [x] A user can fill out at least one document end to end and download the PDF.
- [x] Invalid answers are rejected in the form and again by the API.
- [x] A half-finished document survives a reload.
- [x] Both template kinds (designed and overlay) can be filled and generated.
- [x] A document started on version 1 still generates from version 1 after
      version 2 is published.
- [x] A new admin or template author sees what to do next on the home page,
      and the checklist only lists steps their roles allow.

## Known limitations

- Templates are global. There are no organisations or teams, so every user
  with `document: view` sees every published template.
- Documents are private to their owner; admins don't see other users'
  documents (they see their generations in the log).
- Documents on a template that was archived later can still be finished.
- A finished document's answers can be reopened, but the previous PDF stays
  only in the generation log.
- Templates have no categories yet; the picker searches name and description.
- Two tabs on the same draft overwrite each other; the last save wins.
- Changes made just before closing the tab go out as a keepalive request,
  which browsers cap at 64 KB, so a large image or signature can be lost.
- My documents lists the 1,000 most recently edited; there is no paging yet.

## Resolved questions

- **PDF model.** Both: generate from designed HTML templates
  ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)) and overlay
  or fill existing PDFs
  ([ADR 0013](../adrs/0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
- **Who authors documents.** Editors author templates in the app; users with
  `document: view` fill them. necodoc ships no curated form library.
- **Storage.** Postgres `bytea`
  ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)).

- **Reusing answers.** Yes: start from a previous document (see Behavior).
