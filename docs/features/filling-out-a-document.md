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
- Answers are saved to the user's account so they can come back and finish. A
  document stays on the template version it was started from.
- When the form is complete, the user generates and downloads the PDF. Each
  generation is recorded in the [generation log](generation-log.md).
- Outside people can fill a template without an account through a
  [share link](share-links-and-data-requests.md).
- Admins can read what has shipped and its limits in the
  [Admin FAQ](admin-faq.md).

## Acceptance criteria

- [ ] A user can fill out at least one document end to end and download the PDF.
- [ ] Invalid answers are rejected in the form and again by the API.
- [ ] A half-finished document survives a reload.
- [ ] Both template kinds (designed and overlay) can be filled and generated.
- [ ] A document started on version 1 still generates from version 1 after
      version 2 is published.

## Known limitations

- Templates are global. There are no organisations or teams, so every user
  with `document: view` sees every published template.

## Resolved questions

- **PDF model.** Both: generate from designed HTML templates
  ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)) and overlay
  or fill existing PDFs
  ([ADR 0013](../adrs/0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
- **Who authors documents.** Editors author templates in the app; users with
  `document: view` fill them. necodoc ships no curated form library.
- **Storage.** Postgres `bytea`
  ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)).

## Open questions

- Should a user be able to start a new document from a previous one's answers?
