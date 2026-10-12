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

Enterprise customers have to answer "who changed this template, and when?" The audit log records every change to configuration and access, and every sign-in. The [generation log](generation-log.md) covers renders; this covers everything else. Mechanism: [ADR 0032](../adrs/0032-append-only-audit-log-with-a-request-scoped-actor.md); the event catalogue is [packages/shared/src/audit.ts](../../packages/shared/src/audit.ts).

## Motivation

Compliance reviews ask for change history. When a published document is wrong, the first question is what changed. Security teams want to see who created an API key or granted a role, and failed sign-ins (also the input for usage analytics).

## Behavior

- **Recorded events** (actor, impersonator if any, API key if any, action, target type and id, target name, time, IP, user agent, request id, and a before/after of the changed fields where it applies):
  - templates: create, edit, duplicate, delete, publish ([versions](publishing-and-versions.md)); reviews: submit, approve, request changes, withdraw ([review and approval](review-and-approval.md))
  - themes, assets, snippets: create, edit, delete
  - API keys: create, rotate, revoke ([HTML to PDF API](html-to-pdf-api.md))
  - service accounts: create, edit (roles included), disable, enable
  - share links and webhooks: create, edit, disable, delete
  - users ([user management](user-management-and-roles.md)): create (by an admin, by sign-up, or by SSO on first sign-in), edit, role change (by an admin or synced from the IdP), ban, unban, delete, password set, sessions revoked, impersonation start/stop
  - own account from Settings ([user preferences](user-preferences.md)): name, password, sessions revoked, account deleted
  - sign-in success and failure (password, SSO with its provider, trusted header), sign-out
  - batch jobs: start, cancel ([render queue](render-queue-batch-jobs-and-scaling.md))
  - generation log: bulk delete (with the filter and count), signed download link minted ([generation log](generation-log.md))
  - settings: retention and publishing changes
  - data subject erasure, with counts only ([personal data masking and erasure](personal-data-masking-and-erasure.md))
- **Actors.** A person (with the admin behind them when impersonating), an API key (its owner, or a service account), the system (SSO provisioning and role sync, jobs), or the public (failed sign-ins).
- **Append-only.** No one can edit or delete entries through the app or API, and a database trigger rejects updates and deletes.
- **Admin > Audit log:** filter by actor, action, target type, target, date range and free text (target, actor, request id, IP); sort; page through large volumes server-side; open an entry to see its diff; export the filtered list as CSV.
- **Per-object history:** themes, snippets, share links, service accounts, API keys and templates show their own audit trail.
- **Request ids.** Every API response carries an `X-Request-Id`; audit and generation entries record it, so a customer's support ticket can be traced.
- **No secrets.** Webhook secrets, link tokens and passwords are never recorded.

## Acceptance criteria

- [x] Each action above produces one entry with actor, target and time.
- [x] Editing a template records a diff of the changed fields.
- [x] Editing a theme, snippet, share link, webhook or service account records a diff of the changed fields.
- [x] A failed sign-in is recorded with the email tried and why it failed.
- [x] Actions taken while impersonating record both the admin and the impersonated user.
- [x] A non-admin can't read the audit log; no route edits or deletes entries.
- [x] The filtered list exports as CSV.
- [x] The list stays fast at tens of thousands of entries.

## Known limitations

- Entries are kept forever; there is no retention for the audit log.
- Large rich-text edits store the whole before/after document, not a minimal diff.
- Database administrators can still alter rows directly by disabling the trigger; the log is tamper-resistant, not tamper-evident (no hash chain).
- Field values in diffs are masked only for sensitive fields; names, emails and IPs stay, and entries are never erased ([personal data masking and erasure](personal-data-masking-and-erasure.md)).
- Events recorded by Better Auth hooks (sign-in, admin user actions) are written just after the change, not in its transaction.
- Downloads and signed-link uses aren't recorded, only minting a link.
