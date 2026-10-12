---
type: feature
title: User management and roles
description: Users sign up with email and password and hold one or more roles; admins manage users, roles, bans, passwords and sessions. The first user becomes admin.
tags: [auth, app, api, product]
status: draft
generated: { by: okq/0.9.0, at: 2026-09-25T23:00:21Z }
---

# User management and roles

## Summary

Anyone can sign up with email and password. Access comes from roles that an
admin grants; a user can hold several. Admins manage every account from an
Admin > Users screen. Mechanism:
[ADR 0011](../adrs/0011-role-based-access-with-the-better-auth-admin-plugin.md).

## Motivation

Authoring, reviewing and publishing documents
([Filling out a document](filling-out-a-document.md)) are different jobs that
different people do. Roles let an organisation split them, and admins need to
onboard people and lock them out without touching the database.

## Roles and permissions

"Document" in the permissions below means templates and the content they use
(themes, snippets, assets); see
[Filling out a document](filling-out-a-document.md) for the terms.

Roles are additive: a user's permissions are the union of their roles. Every
role except admin grants one job plus `view`.

| Permission            | admin | publisher | reviewer | editor | viewer |
|-----------------------|:-----:|:---------:|:--------:|:------:|:------:|
| document: view        |   ✓   |     ✓     |    ✓     |   ✓    |   ✓    |
| document: create      |   ✓   |           |          |   ✓    |        |
| document: edit        |   ✓   |           |          |   ✓    |        |
| document: review      |   ✓   |           |    ✓     |        |        |
| document: publish     |   ✓   |     ✓     |          |        |        |
| user management       |   ✓   |           |          |        |        |

Filling documents needs `document: view`; each user sees only their own
documents ([Filling out a document](filling-out-a-document.md)). Share links
need `document: publish`
([Share links and data requests](share-links-and-data-requests.md)).

"User management" is the admin plugin's default `user` and `session`
statements (create, list, set role, ban, impersonate, delete, set password,
revoke sessions).

**Enforced today:** user management requires admin, and users with no roles
are pending (below). Templates enforce the document permissions
([routes/templates.ts](../../apps/api/src/routes/templates.ts)); the other
template features enforce them through the API's role/permission
middleware ([middleware.ts](../../apps/api/src/middleware.ts)) as they ship;
what each permission allows is in
[Publishing and versions](publishing-and-versions.md); `document: review`
also approves or requests changes in
[Review and approval](review-and-approval.md). API keys act with their owner's roles,
narrowed by their scopes
([ADR 0019](../adrs/0019-better-auth-api-keys-for-the-public-api.md),
[ADR 0029](../adrs/0029-service-accounts-and-scoped-api-keys.md)).

Definitions: [packages/shared/src/roles.ts](../../packages/shared/src/roles.ts), used by
[apps/api/src/auth.ts](../../apps/api/src/auth.ts) and
[apps/app/src/lib/auth.ts](../../apps/app/src/lib/auth.ts).

## Behavior

- **First user is admin.** The first account registered gets the admin role.
- **Everyone else starts pending.** Later sign-ups get no roles. They can sign
  in but see only a page telling them to ask an admin for access.
- **Single sign-on** ([Single sign-on](single-sign-on.md)): the first SSO
  sign-in creates the user (JIT). Their roles come from the provider's
  group-to-role map, or its default roles, which are none (pending) unless the
  operator sets them. With a role map, roles are re-synced from the IdP at
  every sign-in. An IdP can't sign in as an existing account with the same
  email unless the operator allows linking for that provider. Password sign-in
  can be turned off.
- **No email.** There is no email verification and no "forgot password" link.
  Admins set and reset passwords.
- **Sign-in and pending.** [Login](../../apps/app/src/routes/login.tsx) and
  [register](../../apps/app/src/routes/register.tsx) link to each other. The
  [signed-in layout](../../apps/app/src/routes/_app.tsx) sends users with no
  roles to the [pending page](../../apps/app/src/routes/pending.tsx). Both
  keep the page a signed-out visitor asked for and return there after sign-in
  ([App shell](app-shell-and-navigation.md)).
- **Admin > Users** ([users.tsx](../../apps/app/src/routes/_app/admin/users.tsx),
  [actions](../../apps/app/src/routes/_app/admin/-user-dialogs.tsx)), shown in the
  nav only to admins:
  - list people (service accounts have their own page), search by part of
    the name or email, filter by role and by status (active, pending,
    banned), sort by name, email or created, and page, all on the server
    ([admin-users.ts](../../apps/api/src/routes/admin-users.ts)); each row
    shows how they sign in (password, SSO providers)
  - a "Waiting for access" card above the list for pending sign-ups (no role
    yet), oldest first, with Grant access and Delete, and a link to the
    full pending list when there are more
  - assign and remove roles (several at once)
  - ban with a reason, and unban
  - revoke a user's sessions, after a confirm
  - create a user with roles and a password
  - edit another user's name and email. Nobody changes their own email, admins
    included: it is the sign-in identifier and can't be verified yet, so a typo
    could lock the only admin out. An admin's email is changed by another admin
    (see [User preferences](user-preferences.md)).
  - set a user's password (form schemas in
    [user.ts](../../packages/shared/src/user.ts))
  - delete a user
  - impersonate a user, after a confirm, with a visible banner and a way to stop
    ([banner](../../apps/app/src/routes/__root.tsx))
  - every action confirms what it did
- **Guards**, enforced by the API so they hold even against direct API calls
  ([admin-guard.ts](../../apps/api/src/admin-guard.ts)):
  - an admin can't delete, ban, or remove admin from themselves, or change
    their own email
  - nobody can remove admin from, ban, or delete the last admin
  - a guarded request the API can't read is refused, not let through
- **Banned users** are told to ask an admin; there is no support contact.
- **Service accounts** (Admin › Service accounts) hold roles like users but
  can't sign in; they own API keys for integrations. Admin › Users doesn't
  list them, and the admin endpoints refuse to impersonate them or set their
  password. See [HTML to PDF API](html-to-pdf-api.md#keys).
- **Own account:** every signed-in user, pending ones included, manages their
  own name, password, sessions and account deletion from Settings
  ([User preferences](user-preferences.md)). The last active admin can't
  delete their own account there either.
- **Audit:** every Admin › Users action, own-account change, sign-in (failed
  ones too) and sign-out is recorded in the [Audit log](audit-log.md), with
  the admin behind an impersonated session.

## Acceptance criteria

- [ ] The first sign-up on an empty database is an admin; the second has no roles.
- [ ] A user with no roles sees only the pending page after signing in.
- [x] A non-admin gets 403 from the admin endpoints and sees no Admin link.
- [ ] An admin can do every action listed under Admin > Users.
- [ ] Self-demotion, self-ban, self-delete and removing the last admin are
      rejected by the API.
- [ ] Impersonation shows a banner and can be stopped.

## Known limitations

- The last-admin guard and the first-user rule check, then write, without a
  lock. Two admins removing each other at the same moment, or two sign-ups at
  the same moment on an empty database, can slip past them. Accepted while
  the user base is small. The same applies to the last admin deleting their own
  account from Settings.

## Open questions

- **Email provider:** needed for verification and self-service password reset.
  Record as an ADR when added.
- **Orgs/teams:** roles are global today; per-organisation roles would need
  Better Auth's organization plugin.
