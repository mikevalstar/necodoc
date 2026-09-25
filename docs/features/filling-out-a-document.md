---
type: feature
title: Filling out a document
description: The core product: a user answers a guided form and gets a completed PDF. The PDF model (fill existing forms vs generate from templates) is still undecided.
tags: [product, pdf, forms, app]
status: draft
generated: { by: okq/0.9.0, at: 2026-09-25T22:50:04Z }
---

# Filling out a document

## Summary

A signed-in user picks a document, answers a guided form, and downloads a
completed PDF. Similar to GhostDraft, aimed at being simpler to set up and use.

## Motivation

Filling in PDFs directly is painful: small fields, no validation, no help, and
the same information typed again and again. A guided form catches mistakes as
they happen, reuses answers, and produces a clean document.

## Behavior

- The user picks a document to fill out.
- The app shows its questions as a form
  ([ADR 0004](../adrs/0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)),
  validated by the same rules the API applies
  ([ADR 0008](../adrs/0008-zod-schemas-shared-between-api-and-app.md)).
- Answers are saved to the user's account so they can come back and finish.
- When the form is complete, the user downloads the finished PDF.

## Acceptance criteria

- [ ] A user can fill out at least one document end to end and download the PDF.
- [ ] Invalid answers are rejected in the form and again by the API.
- [ ] A half-finished document survives a reload.

## Open questions

- **PDF model:** fill existing AcroForm PDFs (pdf-lib to write, pdf.js to
  preview), generate from templates (Typst, react-pdf, or HTML→PDF), or both?
  This decides the main dependency and possibly the deploy target
  ([ADR 0005](../adrs/0005-hono-api-on-node-typed-through-its-rpc-client.md)).
  Record the answer as an ADR.
- **Who authors documents:** do users upload their own PDFs/templates, or does
  necodoc ship a curated library? This shapes the document permissions in
  [User management and roles](user-management-and-roles.md).
- **Storage** for uploaded and generated PDFs (S3/R2/disk). Not needed until
  uploads exist.
