---
type: feature
title: Competitive scope
description: What GhostDraft, DocSpring and Anvil offer, which necodoc spec matches or beats each capability, and what is deliberately out of scope.
tags: [product, pdf]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Competitive scope

## Summary

necodoc aims to beat GhostDraft, DocSpring and Anvil at turning data into
PDFs. This page maps what they offer to our specs. Competitor features were
checked on their sites on 2026-10-11.

## Motivation

A short list keeps scope honest: every capability below has a spec, and
anything we skip has a reason.

## Capabilities

| Capability | Who has it | Our spec |
|---|---|---|
| Guided web form per template, conditional fields | All three | [Template fields and guided form](template-fields-and-guided-form.md) |
| Fill existing PDFs, import AcroForm fields | DocSpring, Anvil | [PDF overlay templates](pdf-overlay-templates.md) |
| AI field detection on upload | DocSpring, Anvil | [PDF overlay templates](pdf-overlay-templates.md) |
| Generate from HTML/CSS with Liquid | DocSpring, Anvil | [Document templates](document-templates.md), [HTML to PDF API](html-to-pdf-api.md) |
| Visual authoring for non-developers | GhostDraft (in Word) | [Document templates](document-templates.md) |
| Reusable clauses / content | GhostDraft | [Snippet library](snippet-library.md) |
| House style across documents | GhostDraft | [Document themes](document-themes.md) |
| Version control, separate publish permission | GhostDraft | [Publishing and versions](publishing-and-versions.md) |
| Public form links / data requests | DocSpring, Anvil | [Share links and data requests](share-links-and-data-requests.md) |
| Combine PDFs, filing packets | DocSpring, GhostDraft | [Combining PDFs into packets](combining-pdfs-into-packets.md) |
| REST API | DocSpring, Anvil | [HTML to PDF API](html-to-pdf-api.md) |
| Webhooks | DocSpring, Anvil | [Webhooks](webhooks.md) |
| QR codes, barcodes, images, drawn signatures | DocSpring | [PDF overlay templates](pdf-overlay-templates.md), [ADR 0015](../adrs/0015-liquidjs-for-templating.md) |
| Async and batch generation | DocSpring, Anvil | [Render queue, batch jobs and scaling](render-queue-batch-jobs-and-scaling.md) |
| Change history / audit trail | GhostDraft | [Audit log](audit-log.md) |
| Hand off to e-sign (signers, field positions) | DocSpring, Anvil (own e-sign) | [Signing packages](signing-packages.md) |

## Where we aim to beat them

- **Both PDF models in one product.** Designed templates and overlays share
  fields, forms, publishing and the API. GhostDraft authors in Word; DocSpring
  and Anvil author in HTML or by placing fields on a PDF. We do all three.
- **Real headers and footers.** Full HTML per page, page tokens, a first-page
  variant ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)).
- **Preview is the output.** Live preview uses the production renderer.
- **Traceability.** Every render logged with input and output, re-runnable
  against the exact version ([Generation log](generation-log.md)).
- **AI drafting** in the editor, not only field detection.
- **Enterprise operations.** Horizontally scaled render workers, queued
  batches, per-render timing breakdowns, cluster metrics, an append-only audit
  log and log retention
  ([Render queue](render-queue-batch-jobs-and-scaling.md),
  [Audit log](audit-log.md)).
- **Self-hostable**, one Node codebase (API and worker roles) and one Postgres.

## Out of scope

- **Legally binding e-signature workflows with an audit trail** (Anvil Etch,
  DocSpring e-sign). Signer identity, tamper-evident audit logs and ESIGN /
  eIDAS compliance are a product of their own. necodoc's signature fields
  capture an image only; [signing packages](signing-packages.md) hand the
  document to DocuSign, Adobe Sign or Dropbox Sign instead.
- **Word/DOCX output.** It needs a second rendering pipeline with different
  layout rules. PDF is the product.
- **Prebuilt industry form libraries** (GhostDraft's ISO/AAIS forms). Content,
  not software.
- **Multi-tenant SaaS (organisations, workspaces, billing).** Every customer self-hosts their own install, so tenancy isolation isn't needed.
- **Official SDKs, embedded editor.** Not now. Each needs its own ADR when
  demand shows. (Async and batch generation moved in scope with
  [ADR 0020](../adrs/0020-pg-boss-job-queue-and-separate-render-worker-processes.md).)

## Known limitations

- Competitor features come from their marketing pages and docs, not hands-on
  use. Recheck before relying on a row.
- GhostDraft's approval workflows are ahead of ours: we have one global
  review gate with one open review per template, no multi-step or assigned
  approvals ([Review and approval](review-and-approval.md)).

## Acceptance criteria

- [ ] Every row in the capabilities table links to a spec that covers it.
- [ ] Each out-of-scope item still has a reason when this page changes.
