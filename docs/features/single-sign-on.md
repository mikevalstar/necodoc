---
type: feature
title: Single sign-on
description: People sign in through their organisation's identity provider (Entra ID, Auth0, SiteMinder or any OIDC or SAML 2.0 IdP, or a trusted SiteMinder-style header), get an account on first sign-in, and get roles from their IdP groups.
tags: [auth, enterprise, app, api]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T23:00:38Z }
---

# Single sign-on

## Summary

Operators configure identity providers in env. The login page shows a button
for each, and can hide email and password. The first sign-in creates the
account. IdP groups map to necodoc roles. Mechanism and trade-offs:
[ADR 0031](../adrs/0031-single-sign-on-with-the-better-auth-sso-plugin-configured-from-env.md).
Setup guides for each IdP are in the developer docs,
[self-hosting › Single sign-on](../../apps/devdocs/src/content/docs/self-hosting/sso.md).

## Motivation

Enterprises won't hand out another password, and they offboard people by
disabling them in one place. Access has to follow the directory: whoever is in
"necodoc-admins" is an admin. Each of Entra ID, Auth0 and SiteMinder can speak
both OIDC and SAML, and which one a customer uses depends on their IT team, so
both protocols work for each.

## Behavior

- **Providers** are listed in `SSO_PROVIDERS` and configured with `SSO_<ID>_*`
  variables: type `oidc`, `saml` or `header`, a button label, and the
  protocol's settings ([sso-config.ts](../../apps/api/src/sso-config.ts)). A bad
  value stops the API at start and names the variable.
- **Login page** ([login.tsx](../../apps/app/src/routes/login.tsx)) shows
  "Sign in with <label>" for each provider. With `AUTH_PASSWORD_ENABLED=false`
  the email and password form and registration are hidden, and the API refuses
  them.
- **First sign-in creates the user** (JIT), named and addressed from the IdP's
  claims or attributes. Sign-in is started from necodoc (SP-initiated).
- **Roles from groups.** A provider's role map (`SSO_<ID>_ROLE_MAP`, JSON:
  group → roles) turns the IdP's groups claim or attribute into roles. A user
  in no mapped group gets the provider's default roles, which are none
  (pending) unless `SSO_<ID>_DEFAULT_ROLES` is set. With a role map, roles are
  recomputed at every sign-in, so a group change takes effect at the next one
  and hand-made role changes are replaced. Without a map, default roles apply
  to new users only and admins manage roles in Admin › Users. A sync never
  takes admin away from the last active admin.
- **Existing accounts aren't taken over.** If the IdP's email matches a user
  who isn't linked to that provider, sign-in is refused unless the provider
  sets `SSO_<ID>_LINK_EXISTING=true`, which links them. `SSO_<ID>_EMAIL_DOMAINS`
  limits the emails a provider may sign in.
- **Service accounts can never sign in by SSO**
  ([ADR 0029](../adrs/0029-service-accounts-and-scoped-api-keys.md)).
- **Trusted-header mode** (type `header`), for SiteMinder web agents and
  similar proxies: off unless configured. It needs the header name and the
  proxy CIDRs, accepts the header only from those addresses, and logs a
  warning at every start while it's on. Provisioning and roles work as above;
  groups can come from another header.
- **Sign-out** ends the necodoc session only. The IdP session stays, so the next
  "Sign in with" may go straight through.
- **Admin › Users** shows how each user signs in: password, and each linked
  provider.

## Acceptance criteria

- [ ] An OIDC sign-in against a test IdP creates the user with the mapped roles.
- [ ] A SAML sign-in against a test IdP does the same.
- [ ] After a group change at the IdP, the next sign-in updates the roles.
- [ ] A user in no mapped group, with no default roles, lands on the pending page.
- [ ] With password sign-in off, the form is hidden and the API refuses email sign-in and sign-up.
- [ ] An IdP asserting an existing password user's email is refused without `LINK_EXISTING`, and linked with it.
- [ ] A service account's email can't sign in by SSO.
- [ ] Header mode signs in from a trusted CIDR and refuses the same request from elsewhere.
- [ ] Admin › Users shows each user's sign-in methods.
- [ ] The developer docs have OIDC and SAML setup for Entra ID, Auth0 and SiteMinder, and header mode with its risk.

## Known limitations

- No SAML single logout: signing out of necodoc doesn't sign out of the IdP.
- No IdP-initiated sign-in (an IdP portal tile must open necodoc's login page).
- No signed AuthnRequests or encrypted assertions.
- SAML IdP config is a certificate or pasted metadata XML; a metadata URL isn't
  fetched, so certificate rotation means updating env.
- Providers change only by env and restart; there's no admin screen.
- Header mode trusts the network: anything inside the proxy CIDRs can sign in
  as anyone, and a necodoc session outlives the proxy's session until it
  expires or the user signs out.
- SSO sign-ins aren't in an audit log yet ([Audit log](audit-log.md)).

## Open questions

- SCIM provisioning, so deprovisioned users are banned before their next
  sign-in attempt.
