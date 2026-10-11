---
type: feature
title: Publishing and versions
description: Templates have one working draft and numbered, immutable published versions. Editing needs document edit; publishing needs document publish. Users fill only published versions.
tags: [product, app, auth]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Publishing and versions

## Summary

Editors change a draft; publishers turn it into a numbered version that users
can fill. Published versions never change, so a document or a re-run always
uses exactly what it was made from.

## Motivation

A template edit must not silently change documents people are halfway
through, or what an API integration produces. Legal and compliance teams also
want someone other than the author to put a change live. This is where the
document permissions in
[User management and roles](user-management-and-roles.md) start being enforced.

## Behavior

- Each template ([designed](document-templates.md) or
  [overlay](pdf-overlay-templates.md)) has one draft and zero or more
  published versions (1, 2, 3...).
- **Permissions:**
  - `document: create` creates templates, themes, snippets and assets
  - `document: edit` changes drafts
  - `document: review` opens drafts and their previews without changing them
  - `document: publish` publishes, archives and restores, and manages
    [share links](share-links-and-data-requests.md)
  - `document: view` lists and fills published templates

  The API enforces these with the role middleware
  ([middleware.ts](../../apps/api/src/middleware.ts)); the app hides what a
  user can't do.
- **Publish** snapshots everything the render needs: content, bands, page
  setup, [fields](template-fields-and-guided-form.md), [theme](document-themes.md)
  CSS, [snippet](snippet-library.md) content, asset references and sample data.
  Later edits to the theme or snippets don't touch it.
- A publisher can add a change note when publishing.
- **Version history.** List versions with publisher, date and note; preview any
  version; start a new draft from an old version.
- **Diff.** Show what changed between the draft and the latest version: fields
  added, removed or changed, and content changed.
- **Archive** hides a template from the fill list and the API. Its versions
  stay for history and re-runs. Restore reverses it.
- Documents and API calls without a version use the latest published one.

## Acceptance criteria

- [ ] A user without `document: edit` can't change a draft, through the app or
      the API.
- [ ] A user without `document: publish` can't publish, through the app or the
      API.
- [ ] Publishing creates version N+1; version N still renders identically.
- [ ] Editing a theme or snippet after publishing doesn't change the published
      output.
- [ ] Only published, non-archived templates appear in the fill list.
- [ ] The diff lists added, removed and changed fields.

## Known limitations

- One draft per template. Two editors on the same draft overwrite each other;
  the last save wins, and the app warns when the draft changed since it was
  opened.
- Review is not a gate. No approval step before publishing yet.
- The content diff is textual, not visual.

## Open questions

- Should publishing require a reviewer's approval when the template opts in?
