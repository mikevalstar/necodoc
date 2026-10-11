---
type: adr
title: Single sign-on with the Better Auth SSO plugin, configured from env
description: OIDC and SAML sign-in use @better-auth/sso with providers declared in environment variables (never registered at runtime); necodoc's own resolver decides provisioning, linking and roles; an optional trusted-header mode serves SiteMinder-style web agents.
tags: [architecture, auth, api, enterprise]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T23:00:33Z }
---

# Single sign-on with the Better Auth SSO plugin, configured from env

## Status

Accepted. Extends [ADR 0007](0007-better-auth-for-authentication.md) and
[ADR 0011](0011-role-based-access-with-the-better-auth-admin-plugin.md);
keeps [ADR 0029](0029-service-accounts-and-scoped-api-keys.md)'s rule that
service accounts never sign in. Behaviour:
[Single sign-on](../features/single-sign-on.md).

## Context

Enterprise customers sign people in through their identity provider: Entra ID,
Auth0 and SiteMinder, each over OIDC or SAML 2.0. Some run SiteMinder as a web
agent in front of the app, which authenticates the user and passes their
identity in a request header. Every install is self-hosted
([ADR 0025](0025-container-images-compose-and-helm-for-self-hosting.md)), so
the operator configures identity the same way as everything else: environment
variables in a `.env` file or Helm values.

Two risks shape the design. An IdP that asserts an email already used by a
necodoc password account must not take that account over. And whatever the IdP
says about groups has to become necodoc roles without an admin re-entering them.

## Decision

- **`@better-auth/sso`** handles both protocols: OIDC with discovery and PKCE,
  SAML 2.0 through samlify (signature checks, InResponseTo, replay and
  timestamp checks, SP metadata). It's the Better Auth plugin for this, so
  sessions, accounts and the admin plugin's roles work unchanged. Rejected:
  `genericOAuth`, which is OIDC only and has no SAML.
- **Providers come from env, not the database.** `SSO_PROVIDERS` lists provider
  ids; each id's settings are `SSO_<ID>_*` variables, parsed into a
  discriminated union (`oidc` | `saml` | `header`) in
  [sso-config.ts](../../apps/api/src/sso-config.ts). They're passed to the plugin
  as `defaultSSO`. The plugin's docs describe `defaultSSO` as a testing aid, but
  its code treats such providers as a first-class "configured" source
  everywhere (sign-in, callbacks, ACS, SP metadata). The provider
  registration and domain-verification endpoints are disabled, so nobody can
  add or change an IdP at runtime. If a later version drops `defaultSSO`, the
  fallback is upserting the same env config into its table at boot.
- **Per-provider variables instead of one JSON blob**, so secrets (client
  secret) can come from their own Kubernetes Secret key, a multi-line PEM
  certificate stays readable, and a typo names the exact variable. The one
  structured value, the group-to-role map, is JSON: group names include commas
  and `=` (LDAP DNs), so a home-made syntax would need escaping.
- **necodoc decides who signs in**, in the plugin's `resolveUser` hook
  ([sso.ts](../../apps/api/src/sso.ts)), which runs inside the sign-in
  transaction with the verified claims or assertion attributes:
  - an identity already linked to a user signs that user in;
  - a new email creates the user there (JIT), with roles from the map;
  - an email that belongs to an existing user is refused unless that
    provider sets `SSO_<ID>_LINK_EXISTING=true`; Better Auth's own email
    linking stays off (`trustEmailVerified` is not set);
  - service accounts are refused, and the session hook from ADR 0029 still
    backs that up;
  - emails outside `SSO_<ID>_EMAIL_DOMAINS`, when set, are refused.
- **Roles follow the IdP when a provider has a role map:** they're recomputed
  on every sign-in. Without a map, a new user gets the provider's default roles
  (none, so pending, unless configured) and admins manage roles afterwards. A
  sync never removes admin from the last active admin.
- **Trusted-header mode** is a `header` provider: an API route reads the user
  from a configured header only when the request's peer address is in the
  provider's proxy CIDRs. With `TRUST_PROXY` the address is the last
  `X-Forwarded-For` hop, as everywhere else
  ([middleware.ts](../../apps/api/src/middleware.ts)). It creates the session
  through a server-only Better Auth endpoint, so it can't be called over HTTP
  without the route's checks. It's off unless configured, and the API logs a
  warning at every boot while it's on.
- **Password sign-in can be turned off** (`AUTH_PASSWORD_ENABLED=false`); Better
  Auth then refuses email sign-in and sign-up.
- **OIDC discovery origins join `trustedOrigins`**, because the plugin only
  fetches discovery documents from trusted origins.
- **Not now:** SAML single logout (the plugin supports it, but it needs an SP
  signing key and per-IdP testing), signed AuthnRequests, encrypted assertions,
  IdP-initiated SAML and OIDC, and SAML metadata URLs fetched at runtime.

## Alternatives considered

- **Providers in the database, managed from an admin screen.** It's what the
  plugin is built around, but config would live in two places (env for
  everything else, a table for this), and a compromised admin session could
  point sign-in at an attacker's IdP.
- **One `SSO_PROVIDERS` JSON value.** Compact, but a whole provider, secrets
  and PEM included, on one escaped line is hard to read and can't split
  secrets out.
- **A reverse proxy doing OIDC (oauth2-proxy) for every customer.** It moves
  role mapping and SAML out of necodoc, and still needs header mode.

## Consequences

- Changing a provider means changing env and restarting. That's the same as
  every other setting.
- `drizzleAdapter` now runs with `transaction: true`; `resolveUser` needs it.
- With a role map, roles an admin sets by hand are replaced at that user's
  next sign-in. The IdP is the source of truth.
- A user can be linked to several providers, and to a password, only when the
  provider allows linking.
- Header mode trusts the network: anyone who can reach the API from inside the
  proxy CIDRs can sign in as anyone. The setup guide says so.
