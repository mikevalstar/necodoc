---
type: feature
title: Admin FAQ
description: An in-app admin page listing every shipped feature, what it does and its limitations; updated in the same change that ships or alters a feature.
tags: [product, app, admin]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Admin FAQ

## Summary

Admin > FAQ explains, in plain language, every feature necodoc has today, what
it does, and where it stops.

## Motivation

Admins field the questions: "can it do X?", "why didn't my logo show?". The
answers are in these specs, but specs are for developers and include unbuilt
work. Admins need the shipped truth inside the app.

## Behavior

- Shown in the nav only to admins.
- One entry per shipped feature: name, what it does (a few sentences), known
  limitations, and who can use it (roles).
- Searchable, and grouped the same way the app's nav is.
- Content lives in one data file in the app, versioned with the code.

## Rule

**Every change that ships, changes or removes a user-visible feature updates
the FAQ in the same change.** Its limitations match the feature spec's "Known
limitations", in plain words. Reviewers reject feature PRs that don't.

## Acceptance criteria

- [ ] Admins see Admin > FAQ; non-admins get no link and a 403 from its data.
- [ ] Every feature spec whose feature has shipped has an entry.
- [ ] Each entry lists limitations and roles.
- [ ] Search finds an entry by a word in its text.

## Known limitations

- Kept current by the rule above, not by tooling. Drift is caught in review.

## Open questions

- Generate entries from the specs' Summary and Known limitations at build time,
  so they can't drift? Specs link to code files and are written for
  reviewers, so they'd need an admin-facing section.
