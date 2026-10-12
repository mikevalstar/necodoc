---
title: Single sign-on
description: OIDC and SAML sign-in with Entra ID, Auth0, SiteMinder or any other IdP, group-to-role mapping, and trusted-header mode.
sidebar:
  order: 10
---

necodoc signs people in with email and password, through your identity provider (IdP) over OIDC or SAML 2.0, or both. IdPs not covered below (Okta, Keycloak, Ping, ADFS…) use the same settings. Design notes: [ADR 0031](https://github.com/mikevalstar/necodoc/blob/main/docs/adrs/0031-single-sign-on-with-the-better-auth-sso-plugin-configured-from-env.md).

## How it works

- `SSO_PROVIDERS` lists provider ids. Each id reads its settings from `SSO_<ID>_*`: the id upper-cased, with `-` replaced by `_`. For example, `entra-saml` reads `SSO_ENTRA_SAML_*`.
- The login page shows **Sign in with &lt;label&gt;** for each provider. `AUTH_PASSWORD_ENABLED=false` hides the email and password form and turns off registration, and the API refuses both.
- **First sign-in creates the user.** Name and email come from the IdP.
- **Roles from groups.** `SSO_<ID>_ROLE_MAP` maps the IdP's group names (or ids) to necodoc roles, as JSON. A user in no mapped group gets `SSO_<ID>_DEFAULT_ROLES`. That's empty by default, so they land on the pending page until an admin grants access.
- **With a role map, the IdP owns roles.** Roles are recomputed at every sign-in: a group change applies at the user's next sign-in, and roles set by hand in Admin › Users get replaced. The last active admin never loses admin this way. Without a role map, default roles apply to new users only, and admins manage roles in necodoc.
- **Existing accounts aren't taken over.** If the IdP asserts an email that already belongs to a necodoc user who isn't linked to this provider, sign-in is refused. `SSO_<ID>_LINK_EXISTING=true` links them instead. Only set it for an IdP that really owns those addresses, ideally with `SSO_<ID>_EMAIL_DOMAINS`.
- **Service accounts can never sign in**, by SSO or any other way.
- The first user on an empty database becomes admin, whichever way they sign in.
- Admin › Users shows how each user signs in.

### URLs to give your IdP

With `BETTER_AUTH_URL=https://necodoc.example.com` and a provider id `<id>`:

| What | URL |
| --- | --- |
| OIDC redirect (callback) URI | `https://necodoc.example.com/api/auth/sso/callback/<id>` |
| SAML ACS (reply) URL | `https://necodoc.example.com/api/auth/sso/saml2/sp/acs/<id>` |
| SAML SP entity id (default) | `https://necodoc.example.com/api/auth/sso/saml2/sp/metadata?providerId=<id>` |
| SAML SP metadata | same as the entity id: open it to download the XML |
| Sign-on / login URL | `https://necodoc.example.com/login` |

Sign-in starts from necodoc. A portal tile that posts straight to the ACS (IdP-initiated) is refused, so point tiles at the login URL.

## Settings

Shared by every type:

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_PASSWORD_ENABLED` | `true` | `false`: SSO only. Needs at least one provider. |
| `SSO_PROVIDERS` | none | Comma-separated provider ids: lowercase letters, digits, dashes. |
| `SSO_<ID>_TYPE` | required | `oidc`, `saml` or `header`. |
| `SSO_<ID>_LABEL` | the id | Button text: "Sign in with &lt;label&gt;". |
| `SSO_<ID>_ROLE_MAP` | none | JSON: group → roles, e.g. `'{"necodoc-admins":["admin"],"writers":["editor","reviewer"]}'`. Group names match case-insensitively. Roles: `admin`, `publisher`, `reviewer`, `editor`, `viewer`. Wrap it in single quotes in a `.env` file. |
| `SSO_<ID>_DEFAULT_ROLES` | none | Comma-separated roles for users in no mapped group. Empty: pending. |
| `SSO_<ID>_LINK_EXISTING` | `false` | `true`: may sign in as an existing user with the same email, and link to them. |
| `SSO_<ID>_EMAIL_DOMAINS` | any | Comma-separated. Refuses other emails, even for linked users. |

OIDC (`TYPE=oidc`):

| Variable | Default | Description |
| --- | --- | --- |
| `SSO_<ID>_ISSUER` | required | Must match the `issuer` in the discovery document exactly, trailing slash included. |
| `SSO_<ID>_DISCOVERY_URL` | `<issuer>/.well-known/openid-configuration` | |
| `SSO_<ID>_CLIENT_ID`, `SSO_<ID>_CLIENT_SECRET` | required | A confidential client. PKCE is always on. |
| `SSO_<ID>_SCOPES` | `openid email profile` | Space or comma separated. |
| `SSO_<ID>_EMAIL_CLAIM` | `email` | |
| `SSO_<ID>_NAME_CLAIM` | `name` | |
| `SSO_<ID>_GROUPS_CLAIM` | `groups` | Read from the ID token, then UserInfo. A list, or one string as one group. |

SAML (`TYPE=saml`):

| Variable | Default | Description |
| --- | --- | --- |
| `SSO_<ID>_ENTRY_POINT` | | The IdP's SSO URL (HTTP-Redirect binding). |
| `SSO_<ID>_IDP_ENTITY_ID` | | The IdP's entity id (issuer). |
| `SSO_<ID>_IDP_CERT` | | The IdP's signing certificate: PEM with real newlines, `\n` escapes, or just the base64 body. |
| `SSO_<ID>_IDP_METADATA` | | The IdP's metadata XML instead of the three above. |
| `SSO_<ID>_SP_ENTITY_ID` | the SP metadata URL | What the IdP calls necodoc ("Identifier", "Audience"). |
| `SSO_<ID>_NAMEID_FORMAT` | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` | The NameID identifies the account; use a stable one. |
| `SSO_<ID>_EMAIL_ATTRIBUTE` | `email` | Falls back to the NameID. |
| `SSO_<ID>_NAME_ATTRIBUTE` | `displayName` | `givenName` + `surname` win when the IdP sends them. |
| `SSO_<ID>_GROUPS_ATTRIBUTE` | `groups` | Multi-valued attribute. |
| `SSO_<ID>_WANT_ASSERTIONS_SIGNED` | `true` | Unsigned assertions are refused. Keep it on. |

Set either `IDP_METADATA`, or all of `ENTRY_POINT`, `IDP_ENTITY_ID` and `IDP_CERT`. Assertions must carry `NotBefore`/`NotOnOrAfter`; clocks may differ by up to 5 minutes.

A bad or missing value stops the API at start, naming the variable. In Helm, put plain settings in `config:` and secrets in a Secret through `extraEnv`:

```yaml
config:
  SSO_PROVIDERS: entra
  SSO_ENTRA_TYPE: oidc
  SSO_ENTRA_ISSUER: https://login.microsoftonline.com/<tenant-id>/v2.0
  SSO_ENTRA_CLIENT_ID: <client-id>
  SSO_ENTRA_ROLE_MAP: '{"<group-id>":["admin"]}'
extraEnv:
  - name: SSO_ENTRA_CLIENT_SECRET
    valueFrom: { secretKeyRef: { name: necodoc-sso, key: entra-client-secret } }
```

## Microsoft Entra ID

### OIDC (app registration)

1. **Entra admin center › App registrations › New registration.** Name it "necodoc". Supported account types: this directory only. Redirect URI: platform **Web**, `https://necodoc.example.com/api/auth/sso/callback/entra`.
2. **Certificates & secrets › New client secret.** Copy the value; it's shown once. Note when it expires.
3. **Token configuration › Add groups claim.** Choose **Security groups**, or better, **Groups assigned to the application**, which avoids the 200-group overage (see below). For the ID token, pick **Group ID**. Also **Add optional claim › ID › email**, or use `preferred_username`.
4. Optional, instead of groups: **App roles › Create app role** (value `necodoc.admin`, `necodoc.editor`…), assign users or groups to them under **Enterprise applications › necodoc › Users and groups**, and set `GROUPS_CLAIM=roles`.
5. Copy the **Directory (tenant) ID** and **Application (client) ID** from Overview.

```sh
SSO_PROVIDERS=entra
SSO_ENTRA_TYPE=oidc
SSO_ENTRA_LABEL=Microsoft
SSO_ENTRA_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
SSO_ENTRA_CLIENT_ID=<application-client-id>
SSO_ENTRA_CLIENT_SECRET=<secret-value>
# Users without the optional email claim: their UPN
# SSO_ENTRA_EMAIL_CLAIM=preferred_username
# Group object ids from Entra › Groups
SSO_ENTRA_ROLE_MAP='{"0b9e…-admins-object-id":["admin"],"5f21…-editors-object-id":["editor","reviewer"]}'
# With app roles instead:
# SSO_ENTRA_GROUPS_CLAIM=roles
# SSO_ENTRA_ROLE_MAP='{"necodoc.admin":["admin"],"necodoc.editor":["editor"]}'
SSO_ENTRA_EMAIL_DOMAINS=example.com
```

Entra puts groups in the ID token only. A user in more than 200 groups gets an overage pointer instead of the list, which necodoc can't follow, so they'd get the default roles. "Groups assigned to the application" or app roles avoid that.

### SAML (enterprise application)

1. **Enterprise applications › New application › Create your own application** › "Integrate any other application you don't find in the gallery". Name it "necodoc".
2. **Single sign-on › SAML › Basic SAML Configuration:**
   - Identifier (Entity ID): `https://necodoc.example.com/api/auth/sso/saml2/sp/metadata?providerId=entra-saml`
   - Reply URL (ACS): `https://necodoc.example.com/api/auth/sso/saml2/sp/acs/entra-saml`
   - Sign on URL: `https://necodoc.example.com/login`

   Or **Upload metadata file**, using the SP metadata from the Identifier URL.
3. **Attributes & Claims:** keep the defaults (email address, name, given name, surname; Unique User Identifier `user.userprincipalname`, format Email address). **Add a group claim** › Security groups or Groups assigned to the application, source attribute Group ID. To send app roles instead, add a claim named `groups` with source attribute `user.assignedroles`.
4. **SAML Certificates:** download **Certificate (Base64)**. Under **Set up necodoc**, copy the **Login URL** and **Microsoft Entra Identifier**.
5. **Users and groups:** assign who may sign in. Unassigned users get AADSTS50105 at Microsoft.

```sh
SSO_PROVIDERS=entra-saml
SSO_ENTRA_SAML_TYPE=saml
SSO_ENTRA_SAML_LABEL=Microsoft
SSO_ENTRA_SAML_ENTRY_POINT=https://login.microsoftonline.com/<tenant-id>/saml2
SSO_ENTRA_SAML_IDP_ENTITY_ID=https://sts.windows.net/<tenant-id>/
SSO_ENTRA_SAML_IDP_CERT="-----BEGIN CERTIFICATE-----
MIIC8DCCAdigAwIBAgIQ…
-----END CERTIFICATE-----"
SSO_ENTRA_SAML_EMAIL_ATTRIBUTE=http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress
SSO_ENTRA_SAML_NAME_ATTRIBUTE=http://schemas.microsoft.com/identity/claims/displayname
SSO_ENTRA_SAML_GROUPS_ATTRIBUTE=http://schemas.microsoft.com/ws/2008/06/identity/claims/groups
SSO_ENTRA_SAML_ROLE_MAP='{"0b9e…-admins-object-id":["admin"]}'
```

Entra signs assertions with a certificate that expires (three years by default). Before it rolls over, put the new certificate in `IDP_CERT` and restart.

## Auth0

### OIDC (Regular Web Application)

1. **Applications › Create Application › Regular Web Applications.**
2. **Settings:** copy Domain, Client ID and Client Secret. **Allowed Callback URLs:** `https://necodoc.example.com/api/auth/sso/callback/auth0`. Allowed Web Origins and Logout URLs aren't needed.
3. **Roles:** create them under **User Management › Roles** (e.g. `necodoc-admins`) and assign users. Auth0 doesn't put roles in tokens by itself, so add a **Post Login Action** (**Actions › Library › Create Action › Login / Post Login**), deploy it, and add it to the Login flow:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     // Custom claims need a namespace that isn't an Auth0 domain.
     api.idToken.setCustomClaim("https://necodoc.example.com/roles", event.authorization?.roles ?? []);
   };
   ```

```sh
SSO_PROVIDERS=auth0
SSO_AUTH0_TYPE=oidc
SSO_AUTH0_LABEL=Auth0
# The trailing slash is part of Auth0's issuer
SSO_AUTH0_ISSUER=https://<tenant>.<region>.auth0.com/
SSO_AUTH0_CLIENT_ID=<client-id>
SSO_AUTH0_CLIENT_SECRET=<client-secret>
SSO_AUTH0_GROUPS_CLAIM=https://necodoc.example.com/roles
SSO_AUTH0_ROLE_MAP='{"necodoc-admins":["admin"],"necodoc-editors":["editor","reviewer"]}'
```

With a custom domain, the issuer is `https://login.example.com/`.

Auth0 can sign people in with social logins whose emails nobody verified. Leave `LINK_EXISTING` off, or limit the connections enabled for this application.

### SAML (SAML2 Web App addon)

1. Create a **Regular Web Application** as above (no callback needed), then **Addons › SAML2 Web App**.
2. **Application Callback URL:** `https://necodoc.example.com/api/auth/sso/saml2/sp/acs/auth0-saml`.
3. **Settings:**

   ```json
   {
     "audience": "https://necodoc.example.com/api/auth/sso/saml2/sp/metadata?providerId=auth0-saml",
     "recipient": "https://necodoc.example.com/api/auth/sso/saml2/sp/acs/auth0-saml",
     "destination": "https://necodoc.example.com/api/auth/sso/saml2/sp/acs/auth0-saml",
     "nameIdentifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
     "nameIdentifierProbes": ["email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
     "mappings": { "email": "email", "name": "displayName" },
     "passthroughClaimsWithNoMapping": false,
     "mapUnknownClaimsAsIs": false
   }
   ```

4. **Roles:** a Post Login Action adds them as a multi-valued attribute:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     if (event.client.client_id === "<client-id>") {
       api.samlResponse.setAttribute("groups", event.authorization?.roles ?? []);
     }
   };
   ```

5. The addon's **Usage** tab gives the Identity Provider Login URL, the Issuer and the certificate (or the metadata URL to download).

```sh
SSO_PROVIDERS=auth0-saml
SSO_AUTH0_SAML_TYPE=saml
SSO_AUTH0_SAML_LABEL=Auth0
SSO_AUTH0_SAML_ENTRY_POINT=https://<tenant>.<region>.auth0.com/samlp/<client-id>
SSO_AUTH0_SAML_IDP_ENTITY_ID=urn:<tenant>.<region>.auth0.com
SSO_AUTH0_SAML_IDP_CERT="<contents of https://<tenant>.<region>.auth0.com/pem>"
SSO_AUTH0_SAML_ROLE_MAP='{"necodoc-admins":["admin"]}'
```

## SiteMinder

Broadcom (Symantec, CA) SiteMinder Federation can be a SAML 2.0 IdP or an OpenID Connect provider. Menu names below follow the Administrative UI in 12.8; they vary a little between releases.

### SAML (partnership)

1. **Federation › Partnership Federation › Entities:** make sure a **local IdP entity** exists (its Entity ID and signing certificate alias). Create a **remote SP entity** for necodoc: import the SP metadata from `https://necodoc.example.com/api/auth/sso/saml2/sp/metadata?providerId=siteminder`, or enter it by hand:
   - Entity ID: `https://necodoc.example.com/api/auth/sso/saml2/sp/metadata?providerId=siteminder`
   - Assertion Consumer Service: `https://necodoc.example.com/api/auth/sso/saml2/sp/acs/siteminder`, binding HTTP-POST
2. **Federation › Partnership Federation › Partnerships › Create Partnership › SAML2 IDP → SP**, with the local IdP and the necodoc SP. Choose the user directories.
3. **Name ID:** format Email Address, type User Attribute, value `mail`. Use a persistent identifier if your directory has one that never changes.
4. **Assertion attributes**, all as user attributes:
   - `email` ← `mail`
   - `displayName` ← `cn` (or `displayName`)
   - `groups` ← the group attribute, e.g. `memberOf` (multi-valued; values are group DNs)
5. **SSO and SLO:** Authentication URL is your SiteMinder-protected login page (often `/siteminderagent/redirectjsp/redirect.jsp`). Enable the HTTP-POST binding, with SP-initiated SSO allowed.
6. **Signature and Encryption:** sign the assertion (or both), with SHA-256. Don't encrypt; necodoc doesn't decrypt assertions.
7. Activate the partnership. Export the IdP's signing certificate (Base64), or export the partnership's IdP metadata.

```sh
SSO_PROVIDERS=siteminder
SSO_SITEMINDER_TYPE=saml
SSO_SITEMINDER_LABEL=Company sign-in
SSO_SITEMINDER_ENTRY_POINT=https://sso.example.com/affwebservices/public/saml2sso
SSO_SITEMINDER_IDP_ENTITY_ID=<local IdP entity ID>
SSO_SITEMINDER_IDP_CERT="-----BEGIN CERTIFICATE-----
…
-----END CERTIFICATE-----"
# or instead of the three above: SSO_SITEMINDER_IDP_METADATA="<?xml …>"
SSO_SITEMINDER_ROLE_MAP='{"cn=necodoc-admins,ou=groups,dc=example,dc=com":["admin"],"cn=necodoc-editors,ou=groups,dc=example,dc=com":["editor","reviewer"]}'
SSO_SITEMINDER_EMAIL_DOMAINS=example.com
```

### OIDC (relying party)

Needs SiteMinder 12.8 SP7 or later, as an OpenID Connect provider.

1. **Federation › OpenID Connect › Authorization Provider:** create or pick one, with your user directory and an authentication URL under `/affwebservices`. It needs a persistent session store.
2. **Claims and scopes:** map `email` ← `mail`, `name` ← `cn`, and a `groups` claim ← `memberOf` (multi-valued), and include them in the `openid`, `email` and `profile` scopes, or in a `groups` scope.
3. **Federation › OpenID Connect › Clients › Create:** a confidential client (client secret, `client_secret_basic` or `client_secret_post`), grant type Authorization Code. Redirect URI exactly `https://necodoc.example.com/api/auth/sso/callback/siteminder-oidc` (no wildcards).
4. Open `https://sso.example.com/affwebservices/CASSO/oidc/<client-name>/.well-known/openid-configuration` and copy its `issuer`.

```sh
SSO_PROVIDERS=siteminder-oidc
SSO_SITEMINDER_OIDC_TYPE=oidc
SSO_SITEMINDER_OIDC_LABEL=Company sign-in
SSO_SITEMINDER_OIDC_ISSUER=<issuer from the discovery document>
SSO_SITEMINDER_OIDC_DISCOVERY_URL=https://sso.example.com/affwebservices/CASSO/oidc/<client-name>/.well-known/openid-configuration
SSO_SITEMINDER_OIDC_CLIENT_ID=<client-id>
SSO_SITEMINDER_OIDC_CLIENT_SECRET=<client-secret>
# Add "groups" if you put the groups claim in its own scope
SSO_SITEMINDER_OIDC_SCOPES=openid email profile
SSO_SITEMINDER_OIDC_ROLE_MAP='{"cn=necodoc-admins,ou=groups,dc=example,dc=com":["admin"]}'
```

## Trusted-header mode

:::danger
In this mode necodoc believes a request header that says who the user is. Anyone who can send a request to the API **from one of the trusted proxy addresses** can sign in as anyone, admins included. Only use it when a SiteMinder web agent (or a similar proxy) is the only way to reach necodoc. Prefer SAML or OIDC.
:::

The proxy authenticates users and passes their identity in headers such as `SM_USER`.

- It's off unless a provider has `TYPE=header`. Only one is allowed. The API logs a warning at every start while it's on.
- The header is believed only when the request's peer address is in `TRUSTED_PROXIES`. That's the TCP peer, or with `TRUST_PROXY` set the client address it picks from `X-Forwarded-For`, as for API key allowlists. Everything else is refused.
- "Sign in with &lt;label&gt;" opens `/api/sso/header/<id>`, which reads the headers, provisions and maps roles like any other provider, and starts a session.

| Variable | Default | Description |
| --- | --- | --- |
| `SSO_<ID>_HEADER` | required | The user id header, e.g. `SM_USER`. Stored as the account id. |
| `SSO_<ID>_EMAIL_HEADER` | `HEADER` | Header with the email (then `HEADER` can be a login name). |
| `SSO_<ID>_NAME_HEADER` | the email's local part | |
| `SSO_<ID>_GROUPS_HEADER` | none | Header with the user's groups. |
| `SSO_<ID>_GROUPS_SEPARATOR` | `,` | SiteMinder joins multi-valued responses with `^`. |
| `SSO_<ID>_TRUSTED_PROXIES` | required | Comma-separated addresses or CIDR ranges of the proxy, as necodoc sees it. |

```sh
SSO_PROVIDERS=siteminder-agent
SSO_SITEMINDER_AGENT_TYPE=header
SSO_SITEMINDER_AGENT_LABEL=Company sign-in
SSO_SITEMINDER_AGENT_HEADER=SM_USER
SSO_SITEMINDER_AGENT_EMAIL_HEADER=SM_EMAIL
SSO_SITEMINDER_AGENT_NAME_HEADER=SM_DISPLAYNAME
SSO_SITEMINDER_AGENT_GROUPS_HEADER=SM_GROUPS
SSO_SITEMINDER_AGENT_GROUPS_SEPARATOR=^
SSO_SITEMINDER_AGENT_TRUSTED_PROXIES=10.20.0.15,10.20.0.16
SSO_SITEMINDER_AGENT_ROLE_MAP='{"necodoc-admins":["admin"]}'
```

The SiteMinder side: define **responses** (Policy Server › Responses) that send `SM_EMAIL`, `SM_DISPLAYNAME` and `SM_GROUPS` as HTTP header variables from user attributes, and attach them to the realm protecting necodoc.

Checklist:

- The proxy must **remove** any of these headers a client sends before adding its own. SiteMinder web agents do this for `SM_` headers; check any other proxy.
- Clients must not reach the API (or the `necodoc-app` container) except through the proxy: firewall it, or bind it to a private network.
- With the `necodoc-app` image between the proxy and the API, the API sees nginx as the peer. Set `TRUST_PROXY=1` on the API and list the web agent's address. nginx drops headers with underscores (`SM_USER`) unless you add `underscores_in_headers on;`; header names with dashes need nothing.
- A necodoc session lasts until it expires or the user signs out, even after the proxy session ends.

## Signing out

Signing out ends the necodoc session only. The IdP session stays, so the next "Sign in with" may go straight through without a password. There's no single logout (SAML SLO or OIDC end-session) yet.

## Troubleshooting

Failed sign-ins come back to the login page with a message, and the API logs a line starting `SSO <id>:`.

| Message or code | Cause |
| --- | --- |
| "An account with your email already exists" (`account_exists`) | A user with that email exists and isn't linked to this provider. Set `LINK_EXISTING=true` if the IdP is authoritative, or change one of the emails. |
| `email_domain` | The email isn't in `EMAIL_DOMAINS`. |
| `service_account` | The IdP asserted a service account's email. |
| `discovery_untrusted_origin`, `issuer_mismatch`, `invalid_provider` | OIDC discovery failed: check `ISSUER` against the discovery document, trailing slash included. |
| `id_token_required_for_user_resolution` | The IdP returned no ID token: include the `openid` scope. |
| `replay_detected`, `invalid_saml_response`, signature errors | SAML: wrong `IDP_CERT`, an unsigned assertion, an assertion reused or older than 5 minutes, or clocks out of sync. |
| `untrusted_proxy`, `no_identity`, `no_email` | Header mode: the request didn't come from `TRUSTED_PROXIES`, or the headers were missing. |
| Signed in but "Waiting for access" | No mapped group and no default roles. Check the groups claim name, and that the IdP sends groups at all. |

## Limitations

- No single logout ([Signing out](#signing-out)) and no IdP-initiated sign-in.
- No signed AuthnRequests and no encrypted assertions.
- SAML IdP metadata URLs aren't fetched. Paste the certificate or metadata XML, and update it when the IdP rotates its certificate.
- Providers are configured by env only; changing one needs a restart.
- No SCIM: someone removed at the IdP keeps their necodoc account (but can't sign in by SSO). Ban them in Admin › Users to end their sessions.
