---
type: feature
title: Review and approval
description: Editors submit a template draft for review; a reviewer sees what changed (structure, pages, tests) and approves or asks for changes; when the admin setting requires it, only an approved, unchanged draft can be published. In-app notifications tell each side.
tags: [product, app, api, auth]
status: draft
---

# Review and approval

## Summary

An editor submits the draft for review with a note. A reviewer opens it, sees
what changed since the published version, and approves it or requests changes
with comments. A publisher then publishes exactly what was approved. An admin
setting makes the approval a gate.

## Motivation

Legal and compliance teams want a second person to check a template change
before it reaches documents and API integrations. The `document: review`
permission ([User management and roles](user-management-and-roles.md)) was
read-only access with no step behind it; GhostDraft's approval workflows were
ahead of ours ([Competitive scope](competitive-scope.md)). This spec adds the
step to [Publishing and versions](publishing-and-versions.md).

## Behavior

- **Settings** (Admin › System › Publishing), off by default:
  - *Require review before publish.*
  - *Allow self-approval*: off means a reviewer can't approve or request
    changes on a review they submitted.

  Settings API: `GET`/`PUT /api/system/publishing` ([routes/system.ts](../../apps/api/src/routes/system.ts)).
  - *Block publish when tests fail* ([Template test cases and visual diff](template-test-cases-and-visual-diff.md)).
- **Submit for review** (`document: edit`): from the template editor, with an
  optional note, on the saved draft. A template has at most one open review;
  submitting again reopens it as pending with the new note.
- **What a review covers.** A review is pinned to a fingerprint of everything
  publishing would freeze: draft content, fields, page setup, sample data, the
  theme's settings and CSS, and snippet content. Any change to those after
  submitting or approving makes the review *stale*: it can't be approved, and
  an approval no longer allows publishing, until the editor resubmits.
  Fingerprint and publish snapshot share one function
  ([publish.ts](../../apps/api/src/publish.ts)).
- **Reviews queue** (Templates › Reviews, `document: review`): open reviews,
  oldest first, with template, submitter, note and whether it is stale.
- **Review page:**
  - structural diff against the latest published version (fields, sections,
    content blocks, header/footer, page setup, theme, overlay boxes), from
    [template-diff.ts](../../packages/shared/src/template-diff.ts)
  - visual diff and test results
    ([Template test cases and visual diff](template-test-cases-and-visual-diff.md))
  - a comment thread, one per review, that also records each state change
  - **Approve** or **Request changes** (a comment is required), for reviewers
  - **Publish** for publishers, once approved and not stale
- **Publish gate.** With review required, publishing is refused unless the
  draft's current fingerprint matches an approved review. Publishing marks
  that review published and links it to the new version.
- **Review history** on the template page: every review with its status,
  submitter, reviewer and dates, linking to the review page.
- **Notifications** (bell in the nav, unread count, polled): review
  requested (to everyone with `document: review` except the submitter),
  changes requested (to the submitter), approved (to the submitter and
  everyone with `document: publish`), published (to the submitter and
  approver). Opening one marks it read; "Mark all read" clears
  them.
- **Audit log.** Submit, comment, approve, request changes, withdraw and
  publish are recorded on the template in the [audit log](audit-log.md).
- API: [routes/reviews.ts](../../apps/api/src/routes/reviews.ts),
  [routes/notifications.ts](../../apps/api/src/routes/notifications.ts);
  payloads in [review.ts](../../packages/shared/src/review.ts).

## Acceptance criteria

- [x] With review required, publishing a draft without an approved review is
      refused, in the app and the API.
- [x] Editing the draft after approval makes the review stale and publish is
      refused again until it is resubmitted and approved.
- [x] A reviewer can't approve their own submission unless self-approval is
      allowed.
- [x] Requesting changes needs a comment, and the submitter is notified.
- [x] The reviewer sees the structural diff, the visual diff and test results
      on the review page.
- [x] Notifications show an unread count and mark read when opened.
- [x] The template page lists the template's review history.

## Known limitations

- One open review per template; parallel reviewers share it, and the first
  decision wins.
- Notifications are in-app only (no email) and poll every 30 seconds.
  Comments don't notify.
- Editing the draft back to exactly what was approved makes the approval
  valid again: the gate compares content, not edit history.
- Review-requested notifications go to every reviewer; there is no assignment.
- A theme or snippet edit makes every open review that uses it stale.
- Reviews of a template with review not required still work, but don't gate
  publishing.

## Open questions

- Per-template review requirement instead of one global setting?
- Assign a review to named reviewers?
