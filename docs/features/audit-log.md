---
type: feature
title: Audit log
description: An append-only record of who changed what (templates, versions, themes, assets, snippets, API keys, share links, webhooks, users and roles), filterable and exportable by admins.
tags: [product, admin, enterprise, auth]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T16:07:59Z }
---

# Audit log

## Summary

Enterprise customers have to answer "who changed this template, and when?" The audit log records every change to configuration and access. The [generation log](generation-log.md) covers renders; this covers everything else.

## Motivation

Compliance reviews ask for change history. When a published document is wrong, the first question is what changed. Security teams want to see who created an API key or granted a role.

## Behavior

- **Recorded events** (actor, impersonator if any, action, target type and id, target name, time, IP, user agent, and a before/after diff of changed fields where it applies):
  - templates: create, edit, duplicate, delete, publish ([versions](publishing-and-versions.md))
  - themes, assets, snippets: create, edit, delete
  - API keys: create, revoke ([HTML to PDF API](html-to-pdf-api.md))
  - share links and webhooks: create, edit, disable, delete
  - users ([user management](user-management-and-roles.md)): create, role change, ban, unban, delete, password set, sessions revoked, impersonation start/stop
  - batch jobs: start, cancel ([render queue](render-queue-batch-jobs-and-scaling.md))
  - settings: retention changes
- **Append-only.** No one can edit or delete entries through the app or API.
- **Admin > Audit log:** filter by actor, action, target type, target and date range; open an entry to see its diff; export the filtered list as CSV.
- **Per-object history:** a template's page shows its own audit trail.
- **Request ids.** Every API response carries an `X-Request-Id`; audit and generation entries record it, so a customer's support ticket can be traced.

## Acceptance criteria

- [ ] Each action above produces one entry with actor, target and time.
- [ ] Editing a template records a diff of the changed fields.
- [ ] Actions taken while impersonating record both the admin and the impersonated user.
- [ ] A non-admin can't read the audit log; no route edits or deletes entries.
- [ ] The filtered list exports as CSV.

## Known limitations

- Entries are kept forever; there is no retention for the audit log.
- Large rich-text edits store the whole before/after document, not a minimal diff.
- Database administrators can still alter rows directly; the log is append-only at the application level.
