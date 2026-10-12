---
type: adr
title: Service accounts and scoped API keys
description: API keys belong to a person or to a service account (a user row that can never sign in), carry scopes no wider than their owner's roles, and keep their policy (scopes, templates, IP allowlist, expiry, revocation, usage) in our own table beside the Better Auth key.
tags: [architecture, api, auth]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T22:24:18Z }
---

# Service accounts and scoped API keys

## Status

Accepted. Amends [ADR 0019](0019-better-auth-api-keys-for-the-public-api.md)
("keys belong to a user") and builds on
[ADR 0011](0011-role-based-access-with-the-better-auth-admin-plugin.md).
Behaviour is in [HTML to PDF API](../features/html-to-pdf-api.md) and
[User management and roles](../features/user-management-and-roles.md). Rate limiting is
[ADR 0048](0048-api-key-rate-limit-counted-per-hour-in-postgres.md).

## Context

ADR 0019 tied every key to a person. Integrations outlive people: when the
developer who made the billing system's key leaves and is banned, billing stops
rendering. Systems need an identity of their own that admins manage.

A key that acts with all of its owner's roles is also too broad. A payroll
integration that only renders one template shouldn't be able to list every
template, read the log or start batches. Customers ask for scopes, expiry,
rotation without downtime, IP allowlists and usage per key.

The `@better-auth/api-key` plugin hashes, verifies and rate-limits keys well,
but it deletes keys when they expire, lets the signed-in owner re-enable or
edit a key through its own endpoints, and its request count resets every
rate-limit window.

## Decision

- **A service account is a `user` row that can't sign in**, marked by the
  `serviceAccount` user field, with its description and owner contact in a
  `service_account` table. It has no credential account, and a database hook
  refuses to create a session for it, so no sign-in path, impersonation
  included, works. It holds roles like a person, so everything that checks
  roles, logs a user or scopes "own generations" works unchanged. Admins
  create and disable them; disabling is the admin plugin's ban.
- **Keys belong to a user or a service account** (the plugin's `referenceId`
  is the user id either way). Personal keys are managed by their owner,
  service-account keys by admins.
- **Scopes narrow a key.** A key holds a subset of fixed scopes
  (`render:html`, `templates:read`, `templates:generate`, `generations:read`,
  `batches:read`, `batches:write`, `combine:write`), each of which needs a
  role permission. A key can only be given scopes its owner's roles allow,
  and is checked against both on every call, so demoting the owner still
  restricts the key. A key can be limited to some templates.
- **Our `api_key_policy` table** holds what the plugin doesn't: scopes,
  template restriction, IP/CIDR allowlist, expiry, revocation, the key it
  replaced, and usage (total requests, last used at and from where). It's the
  source of truth for whether a key may be used. Expiry and revocation keep
  the row, so the generation log and the admin key list still name it.
- **The plugin keeps the secret and the rate limit:** key generation with a
  `nd_` prefix, hashing, lookup, per-key rate limiting. Its HTTP endpoints are
  disabled (`disabledPaths`); keys are created and changed only through our
  routes, which call it server-side.
- **Rotation is create-then-revoke.** Rotating creates a replacement with the
  same settings and sets the old key to expire after an overlap window.
- **Banned users' and disabled service accounts' keys stop working**, checked
  on every call. Keys never create sessions.

## Alternatives considered

- **Better Auth organizations, keys owned by an organization.** The plugin
  supports it, but necodoc has no organizations; it would add membership and
  org roles to model one thing.
- **A separate `service_account` principal with its own roles.** Every role
  check, generation-log join and "own generations" filter would need a second
  owner type.
- **Plugin `permissions` and `expiresAt`.** Expired keys get deleted, and
  permissions can't be typed or edited without going through endpoints we
  have to disable anyway.

## Consequences

- Service accounts appear wherever users do (log filters, batch owners);
  Admin › Users hides them.
- Two rows per key (plugin and policy) must stay in step; a key without a
  policy row is refused.
- Rate limiting is the plugin's: a fixed number of requests per window,
  counted per key in Postgres, so every call writes to the key's row.
- IP allowlists see the proxy unless `TRUST_PROXY` is set behind a reverse
  proxy.
