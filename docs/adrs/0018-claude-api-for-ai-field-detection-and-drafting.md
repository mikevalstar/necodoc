---
type: adr
title: Claude API for AI field detection and drafting
description: Optional AI features call Claude Sonnet (claude-sonnet-5-5) through the Anthropic TypeScript SDK with a key from ANTHROPIC_KEY; it detects fields on uploaded PDFs and helps draft template content. Output is always a suggestion the user reviews.
tags: [architecture, api, app, ai]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Claude API for AI field detection and drafting

## Status

Accepted. The SDK choice is superseded by [ADR 0022](0022-vercel-ai-sdk-for-all-ai-features.md) (Vercel AI SDK with the Anthropic provider); the rest stands. How detection gets its inputs (server-side extraction, a queue job, geometry snapping) is superseded by [ADR 0028](0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md).

## Context

Placing fields on a 12-page form by hand takes an hour. DocSpring and Anvil
both detect fields on upload. Authors also ask for help writing clauses and
boilerplate in [document templates](../features/document-templates.md). Both
jobs need a model that reads page images and text together.

Self-hosters may not want document content sent to a third party, or may not
have a key.

## Decision

- Use the **Claude API** through the official `@anthropic-ai/sdk`, called only
  from the API. The model is Claude Sonnet, `claude-sonnet-5-5`: fast and cheap
  enough to run on every upload, and good at reading forms.
- The key comes from the optional env var `ANTHROPIC_KEY`, validated in
  [env.ts](../../apps/api/src/env.ts) and passed to the SDK explicitly. Without
  it every AI feature is off: endpoints return 404 and the app hides the
  controls.
- **Field detection**
  ([PDF overlay templates](../features/pdf-overlay-templates.md)). The app
  sends page images,
  the page text with coordinates, and existing AcroForm fields, all extracted
  with pdf.js ([ADR 0017](0017-pdf-js-for-pdf-rendering-in-the-app.md)). The
  API asks Claude for fields with a name, type, label, page and rectangle, and
  gets them back as structured output validated by a zod schema in
  `packages/shared`.
- **Drafting.** In the template editor a user describes what they want; Claude
  returns HTML that uses only the template's declared fields. The response
  streams.
- **AI output is always a suggestion.** Detected fields arrive unsaved and
  marked for review; drafted text is inserted only when the user accepts it.
  Nothing AI-generated is published without a person saving it.
- A refusal or invalid response shows "no suggestions" and changes nothing.

## Consequences

- Page content goes to Anthropic. The UI says so next to each AI control.
- Detection quality varies by form. Rectangles from vision are approximate;
  text coordinates and AcroForm rectangles anchor them, but the user still
  checks every box.
- Every AI call costs money, and there's no per-user quota yet.
- AI detection is UI-only for now; the public API doesn't expose it.
