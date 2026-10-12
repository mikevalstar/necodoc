---
type: feature
title: Template test cases and visual diff
description: Named test data sets per template with optional assertions, run on the draft before review or publish, plus a page-by-page visual and text diff between the published version and the draft.
tags: [product, app, api]
status: draft
---

# Template test cases and visual diff

## Summary

Editors save named data sets for a template and assert what the PDF must look
like. "Run tests" renders each one against the draft. A visual diff renders the
published version and the draft with the same data and shows, page by page,
what moved.

## Motivation

A change that looks right with the sample data can break a long address, a
missing optional field or a ten-row table. Reviewers ([Review and approval](review-and-approval.md))
need to see what a change does to real documents, not only to the template's
structure.

## Behavior

- **Test cases** (Tests tab in the template editor; `document: edit` to change,
  drafts users to run): a name, data JSON and optional assertions. Create one
  from the sample data, from a past [generation](generation-log.md)'s input,
  or from a [document](filling-out-a-document.md) (its answers).
- **Assertions**, each optional:
  - renders without error (always checked)
  - data validates against the fields
  - no overlay "text cut" warnings ([PDF overlay templates](pdf-overlay-templates.md))
  - page count equals N, or is at most N
  - text contains / doesn't contain a string (any page)
- **Run tests** renders every case on the saved draft through the preview
  path: not logged, not queued, a few at a time. Each case shows pass or fail
  with the failing checks.
- **Visual diff** for one test case or the sample data: renders the latest
  published version and the draft, rasterises each page on the server (pdf.js,
  as AI detection does: [ADR 0028](../adrs/0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md)),
  and computes a pixel diff per page with the changed-pixel percentage and a
  diff image, plus a line diff of each page's text. The page list shows which
  pages changed; each page toggles side by side, overlay and diff.
- **Where results show:** the Tests tab, the review page, and the publish
  dialog (test status and visual diff before confirming).
- **Block publish when tests fail** (admin setting, off by default): publish
  runs the tests and is refused if one fails.
- Code: [template-tests.ts](../../apps/api/src/template-tests.ts),
  [visual-diff.ts](../../apps/api/src/visual-diff.ts),
  [routes/template-tests.ts](../../apps/api/src/routes/template-tests.ts),
  schemas in [template-test.ts](../../packages/shared/src/template-test.ts).

## Acceptance criteria

- [x] A test case can be created from sample data, a generation's input and a
      document.
- [x] Running tests reports pass or fail per case with the failing checks, and
      writes nothing to the generation log.
- [x] The visual diff marks the pages that changed and its diff image
      highlights the changed area.
- [x] With "block publish when tests fail" on, a failing case refuses publish.

## Known limitations

- Tests run on the saved draft, not unsaved edits.
- Text checks read the PDF's extracted text: wide letter-spacing can split a
  word into letters, so a check for it fails.
- The visual diff compares with the latest published version only; the first
  version has nothing to compare with.
- Pages are compared at the same index: inserting a page early marks every
  later page changed.
- Pixel diffs are rendered at 1.5x (108 dpi); sub-pixel shifts can show as
  small changes.
- Results aren't stored; each open runs them again.
- Up to 20 pages are compared; longer documents show the first 20.
- Test cases aren't part of what a review approves: changing one doesn't make
  a review stale.
