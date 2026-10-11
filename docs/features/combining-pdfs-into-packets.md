---
type: feature
title: Combining PDFs into packets
description: Merge several generated documents and uploaded PDFs into one PDF, from the app or the API.
tags: [product, pdf, app, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Combining PDFs into packets

## Summary

Pick generated documents and uploaded PDFs, order them, and get one PDF: a
policy packet, an onboarding pack, a closing binder.

## Motivation

Packets are how documents actually get sent. GhostDraft builds filing packets,
DocSpring has a combine endpoint. Without this, users merge PDFs in a desktop
tool after every generation.

## Behavior

- **Inputs**, in any order:
  - existing generations from the [generation log](generation-log.md) the user
    can see
  - uploaded PDF files
  - new generations from a template and data, rendered as part of the request
- **App.** Select generations from "My generations" (or Admin > Generations),
  add uploads, drag to reorder, combine, download.
- **API.** `POST /api/v1/combine` with generation ids (the key owner's) and
  base64-encoded PDFs, in order ([HTML to PDF API](html-to-pdf-api.md)). It
  runs as a queued job like any render and answers like render: the PDF, JSON
  with a download link, or `202`.
- Merging uses pdf-lib
  ([ADR 0013](../adrs/0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md)).
  Inputs are flattened first.
- The result is a generation of its own (source "combine"), listing its inputs.
- The combined file is capped at 20 MB like any stored file
  ([ADR 0014](../adrs/0014-binary-files-stored-in-postgres.md)).

## Acceptance criteria

- [ ] Combining two generations and one upload produces one PDF with all pages
      in the chosen order.
- [ ] The API combine accepts all three input kinds in one request.
- [x] A user can't combine generations they aren't allowed to see. (API: a
      key can combine only its account's generations.)
- [x] The combined PDF appears in the generation log with its inputs.

## Known limitations

- No bookmarks, table of contents or page renumbering across the packet.
- Form fields from inputs are flattened.
- Encrypted PDFs can't be inputs.
- No saved packet definitions. Each combine is a one-off.
- The API doesn't yet take template-and-data inputs; generate first
  (`response: "json"`), then combine the generation ids.
- The app side (selecting generations to combine) isn't built yet.
