---
type: adr
title: Role-based access with the Better Auth admin plugin
description: Roles and permissions use the Better Auth admin plugin with createAccessControl; users hold several roles, stored as a comma list and parsed by a shared zod enum.
tags: [architecture, auth, api, shared]
status: stable
generated: { by: okq/0.9.0, at: 2026-09-25T23:00:21Z }
---

# Role-based access with the Better Auth admin plugin

## Status

Accepted. Builds on [ADR 0007](0007-better-auth-for-authentication.md) and
amends how [ADR 0008](0008-zod-schemas-shared-between-api-and-app.md) is
applied. Behaviour is specified in
[User management and roles](../features/user-management-and-roles.md).

## Context

necodoc needs roles (admin, publisher, reviewer, editor, viewer), and one person
can hold several of them. Admins need to manage users: list them, set roles,
ban, reset passwords, impersonate. The API and the app must agree on what each
role may do, without writing the rules twice.

## Decision

- Use the Better Auth **admin plugin** with `createAccessControl`. The plugin
  already provides user-management endpoints, bans, session revocation and
  impersonation, and `createAccessControl` gives typed permission statements.
- **Multiple roles** are stored the Better Auth way: a comma-separated list in
  `user.role`. A zod enum of role names in `packages/shared` parses that string
  into a typed `Role[]`; role types come from `z.infer`, never hand-written.
- The **access-control definitions** (statements, role objects, the role enum
  and the parser) live in `packages/shared` ([roles.ts](../../packages/shared/src/roles.ts)),
  so the API's `admin()` plugin in [auth.ts](../../apps/api/src/auth.ts) and the
  app's `adminClient()` in [auth.ts](../../apps/app/src/lib/auth.ts) share them.
- **Amendment to ADR 0008:** `@necodoc/shared` now depends on `better-auth`,
  but imports only `better-auth/plugins/access` and
  `better-auth/plugins/admin/access` (the plugin's default statements), which
  are browser-safe. The
  package's browser-safe rule still holds; nothing else from Better Auth may be
  imported there.
- **First registered user becomes admin**; later sign-ups get no roles. This is
  a Better Auth database hook on user creation, and it must win over the
  plugin's `defaultRole`.
- Guards that protect admins (no self-demotion, no removing the last admin)
  run as Better Auth hooks on the `/admin/*` endpoints, so calling the auth
  API directly can't bypass them.
- **No email provider for now.** No verification and no reset-by-email; admins
  set passwords. Adding email is a future ADR.

## Alternatives considered

- **Own `user_role` join table.** Proper relational multi-role storage, but
  we'd give up the admin plugin's endpoints, `hasPermission` checks and client
  helpers, or maintain a second source of truth beside `user.role`. Not worth
  it for five roles.
- **Single role per user.** Simpler, but the roles are orthogonal (a reviewer
  can also be an editor) and combining them would need composite roles.

## Consequences

- Roles live in one column, so "all users with role X" is a string match rather
  than a join. Fine at our scale.
- Changing the role list means editing the shared enum and access-control
  definitions together; both sides pick it up.
- Better Auth plugin changes regenerate the auth tables
  ([ADR 0007](0007-better-auth-for-authentication.md)).
- Without email, a user who forgets their password has to ask an admin.
