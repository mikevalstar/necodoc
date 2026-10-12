import type { FaqGuide } from "./faq";

// Setup guides for the single sign-on FAQ entries. Mirrors
// apps/devdocs/src/content/docs/self-hosting/sso.md; change both together. Variable names and
// formats come from apps/api/src/sso-config.ts. Hosts, ids and secrets are placeholders.

const app = "https://necodoc.example.com";
const callback = (id: string) => `${app}/api/auth/sso/callback/${id}`;
const acs = (id: string) => `${app}/api/auth/sso/saml2/sp/acs/${id}`;
const spEntityId = (id: string) => `${app}/api/auth/sso/saml2/sp/metadata?providerId=${id}`;

const testOidc = (id: string) =>
  `Test: restart the API (a bad value stops it, naming the variable). Open ${app}/login in a private window, choose Sign in with the label and sign in as someone in a mapped group. The API logs "SSO ${id}: created …" with their roles, and Admin › Users shows them with single sign-on.`;
const testSaml = (id: string) =>
  `Test: restart the API, then open ${spEntityId(id)}: XML naming the ACS URL means the provider loaded. Sign in from ${app}/login in a private window as someone in a mapped group, and check the API log ("SSO ${id}: created …") and Admin › Users.`;

export const ssoGuides: readonly FaqGuide[] = [
  {
    provider: "Entra ID",
    protocol: "OIDC (app registration)",
    steps: [
      `Entra admin center › App registrations › New registration. Name: necodoc. Supported account types: this directory only. Redirect URI: platform Web, ${callback("entra")}.`,
      "Certificates & secrets › New client secret. Copy the value (shown once) and note when it expires.",
      "Token configuration › Add groups claim › Groups assigned to the application (avoids the 200-group overage) or Security groups, as Group ID in the ID token. Also Add optional claim › ID › email.",
      "Enterprise applications › necodoc › Users and groups: assign the groups that may sign in.",
      "Copy the Directory (tenant) ID and Application (client) ID from Overview, and the object id of each group from Entra › Groups.",
      testOidc("entra"),
    ],
    examples: [
      {
        title: "necodoc env: Entra ID over OIDC",
        lang: "env",
        code: `SSO_PROVIDERS=entra
SSO_ENTRA_TYPE=oidc
SSO_ENTRA_LABEL=Microsoft
SSO_ENTRA_ISSUER=https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0
SSO_ENTRA_CLIENT_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
SSO_ENTRA_CLIENT_SECRET=FAKE~secret~value~replace~me
SSO_ENTRA_EMAIL_DOMAINS=example.com
# Without the optional email claim, use the UPN:
# SSO_ENTRA_EMAIL_CLAIM=preferred_username`,
      },
      {
        title: "Role mapping: Entra group object ids",
        lang: "env",
        code: `SSO_ENTRA_ROLE_MAP='{"00000000-0000-0000-0000-00000000ad01":["admin"],"00000000-0000-0000-0000-00000000ed01":["editor","reviewer"]}'
# Nobody in a mapped group: pending, unless you set defaults
# SSO_ENTRA_DEFAULT_ROLES=viewer`,
        note: "Entra puts groups in the ID token only. Someone in more than 200 groups gets an overage pointer instead, which necodoc can't follow; Groups assigned to the application avoids that.",
      },
      {
        title: "Role mapping: Entra app roles instead of groups",
        lang: "env",
        code: `SSO_ENTRA_GROUPS_CLAIM=roles
SSO_ENTRA_ROLE_MAP='{"necodoc.admin":["admin"],"necodoc.editor":["editor"]}'`,
        note: "Create the app roles under App registrations › necodoc › App roles and assign people or groups to them in the enterprise application.",
      },
    ],
  },
  {
    provider: "Entra ID",
    protocol: "SAML (enterprise application)",
    steps: [
      'Enterprise applications › New application › Create your own application › "Integrate any other application you don\'t find in the gallery". Name: necodoc.',
      `Single sign-on › SAML › Basic SAML Configuration. Identifier (Entity ID): ${spEntityId("entra-saml")}. Reply URL (ACS): ${acs("entra-saml")}. Sign on URL: ${app}/login.`,
      "Attributes & Claims: keep the defaults (Unique User Identifier user.userprincipalname as Email address). Add a group claim › Groups assigned to the application or Security groups, source attribute Group ID.",
      "SAML Certificates: download Certificate (Base64). Under Set up necodoc, copy the Login URL and Microsoft Entra Identifier.",
      "Users and groups: assign who may sign in. Unassigned people get AADSTS50105 at Microsoft.",
      testSaml("entra-saml"),
    ],
    examples: [
      {
        title: "necodoc env: Entra ID over SAML",
        lang: "env",
        code: `SSO_PROVIDERS=entra-saml
SSO_ENTRA_SAML_TYPE=saml
SSO_ENTRA_SAML_LABEL=Microsoft
SSO_ENTRA_SAML_ENTRY_POINT=https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/saml2
SSO_ENTRA_SAML_IDP_ENTITY_ID=https://sts.windows.net/11111111-2222-3333-4444-555555555555/
SSO_ENTRA_SAML_IDP_CERT="-----BEGIN CERTIFICATE-----
MIIC8DCCAdigAwIBAgIQFAKEFAKEFAKE...
-----END CERTIFICATE-----"
SSO_ENTRA_SAML_EMAIL_ATTRIBUTE=http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress
SSO_ENTRA_SAML_NAME_ATTRIBUTE=http://schemas.microsoft.com/identity/claims/displayname
SSO_ENTRA_SAML_GROUPS_ATTRIBUTE=http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`,
        note: "The certificate can also be one line with \\n escapes, or just the base64 body. Entra's expires after three years: put the new one in IDP_CERT and restart before it rolls over.",
      },
      {
        title: "Role mapping: Entra group object ids",
        lang: "env",
        code: `SSO_ENTRA_SAML_ROLE_MAP='{"00000000-0000-0000-0000-00000000ad01":["admin"],"00000000-0000-0000-0000-00000000ed01":["editor","reviewer"]}'`,
      },
    ],
  },
  {
    provider: "Auth0",
    protocol: "OIDC (Regular Web Application)",
    steps: [
      "Applications › Create Application › Regular Web Applications.",
      `Settings: copy Domain, Client ID and Client Secret. Allowed Callback URLs: ${callback("auth0")}.`,
      "User Management › Roles: create the roles (necodoc-admins, necodoc-editors) and assign people.",
      "Auth0 doesn't put roles in tokens by itself: Actions › Library › Create Action › Login / Post Login with the code below, deploy it and add it to the Login flow.",
      testOidc("auth0"),
    ],
    examples: [
      {
        title: "Auth0 Post Login Action: roles into the ID token",
        lang: "js",
        code: `exports.onExecutePostLogin = async (event, api) => {
  // Custom claims need a namespace that isn't an Auth0 domain.
  api.idToken.setCustomClaim("https://necodoc.example.com/roles", event.authorization?.roles ?? []);
};`,
      },
      {
        title: "necodoc env: Auth0 over OIDC",
        lang: "env",
        code: `SSO_PROVIDERS=auth0
SSO_AUTH0_TYPE=oidc
SSO_AUTH0_LABEL=Auth0
# The trailing slash is part of Auth0's issuer
SSO_AUTH0_ISSUER=https://example-tenant.us.auth0.com/
SSO_AUTH0_CLIENT_ID=FAKEclientIdAbc123
SSO_AUTH0_CLIENT_SECRET=FAKE-client-secret-replace-me
SSO_AUTH0_GROUPS_CLAIM=https://necodoc.example.com/roles
SSO_AUTH0_ROLE_MAP='{"necodoc-admins":["admin"],"necodoc-editors":["editor","reviewer"]}'`,
        note: "With a custom domain the issuer is https://login.example.com/. Auth0 social logins can carry unverified emails, so leave LINK_EXISTING off.",
      },
    ],
  },
  {
    provider: "Auth0",
    protocol: "SAML (SAML2 Web App addon)",
    steps: [
      "Create a Regular Web Application (no callback URL needed), then Addons › SAML2 Web App.",
      `Application Callback URL: ${acs("auth0-saml")}. Settings: the JSON below.`,
      "Add the Post Login Action below to the Login flow, so roles go out as a groups attribute.",
      "The addon's Usage tab gives the Identity Provider Login URL, the Issuer and the certificate.",
      testSaml("auth0-saml"),
    ],
    examples: [
      {
        title: "Auth0 SAML2 Web App settings",
        lang: "json",
        code: `{
  "audience": "${spEntityId("auth0-saml")}",
  "recipient": "${acs("auth0-saml")}",
  "destination": "${acs("auth0-saml")}",
  "nameIdentifierFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  "nameIdentifierProbes": ["email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"],
  "mappings": { "email": "email", "name": "displayName" },
  "passthroughClaimsWithNoMapping": false,
  "mapUnknownClaimsAsIs": false
}`,
      },
      {
        title: "Auth0 Post Login Action: roles as a SAML attribute",
        lang: "js",
        code: `exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id === "FAKEclientIdAbc123") {
    api.samlResponse.setAttribute("groups", event.authorization?.roles ?? []);
  }
};`,
      },
      {
        title: "necodoc env: Auth0 over SAML",
        lang: "env",
        code: `SSO_PROVIDERS=auth0-saml
SSO_AUTH0_SAML_TYPE=saml
SSO_AUTH0_SAML_LABEL=Auth0
SSO_AUTH0_SAML_ENTRY_POINT=https://example-tenant.us.auth0.com/samlp/FAKEclientIdAbc123
SSO_AUTH0_SAML_IDP_ENTITY_ID=urn:example-tenant.us.auth0.com
# The PEM from https://example-tenant.us.auth0.com/pem
SSO_AUTH0_SAML_IDP_CERT="-----BEGIN CERTIFICATE-----
MIIDHTCCAgWgAwIBAgIJFAKEFAKEFAKE...
-----END CERTIFICATE-----"
SSO_AUTH0_SAML_ROLE_MAP='{"necodoc-admins":["admin"],"necodoc-editors":["editor","reviewer"]}'`,
      },
    ],
  },
  {
    provider: "SiteMinder",
    protocol: "SAML (partnership)",
    steps: [
      `Federation › Partnership Federation › Entities: check the local IdP entity (Entity ID, signing certificate). Create a remote SP entity for necodoc by importing ${spEntityId("siteminder")}, or by hand: Entity ID ${spEntityId("siteminder")}, Assertion Consumer Service ${acs("siteminder")} with binding HTTP-POST.`,
      "Partnerships › Create Partnership › SAML2 IDP → SP with the local IdP and the necodoc SP, and pick the user directories.",
      "Name ID: format Email Address, type User Attribute, value mail (or a persistent id that never changes).",
      "Assertion attributes, as user attributes: email ← mail, displayName ← cn, groups ← memberOf (multi-valued; the values are group DNs).",
      "SSO and SLO: allow SP-initiated SSO with the HTTP-POST binding. Signature: sign the assertion with SHA-256; don't encrypt it.",
      "Activate the partnership and export the IdP signing certificate (Base64) or the IdP metadata.",
      testSaml("siteminder"),
    ],
    examples: [
      {
        title: "necodoc env: SiteMinder over SAML",
        lang: "env",
        code: `SSO_PROVIDERS=siteminder
SSO_SITEMINDER_TYPE=saml
SSO_SITEMINDER_LABEL=Company sign-in
SSO_SITEMINDER_ENTRY_POINT=https://sso.example.com/affwebservices/public/saml2sso
SSO_SITEMINDER_IDP_ENTITY_ID=https://sso.example.com/idp
SSO_SITEMINDER_IDP_CERT="-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIEFAKEFAKEFAKE...
-----END CERTIFICATE-----"
# Or instead of the three above: SSO_SITEMINDER_IDP_METADATA="<?xml ...>"
SSO_SITEMINDER_EMAIL_DOMAINS=example.com`,
      },
      {
        title: "Role mapping: LDAP group DNs",
        lang: "env",
        code: `SSO_SITEMINDER_ROLE_MAP='{"cn=necodoc-admins,ou=groups,dc=example,dc=com":["admin"],"cn=necodoc-editors,ou=groups,dc=example,dc=com":["editor","reviewer"]}'`,
        note: "Group names match ignoring case. Each value of the groups attribute is one group, so commas inside a DN are fine.",
      },
    ],
  },
  {
    provider: "SiteMinder",
    protocol: "OIDC (relying party)",
    steps: [
      "Needs SiteMinder 12.8 SP7 or later as an OpenID Connect provider.",
      "Federation › OpenID Connect › Authorization Provider: create or pick one with your user directory and a persistent session store.",
      "Claims and scopes: email ← mail, name ← cn, groups ← memberOf (multi-valued), included in the openid, email and profile scopes or a groups scope.",
      `Federation › OpenID Connect › Clients › Create: a confidential client with a secret, grant type Authorization Code, redirect URI exactly ${callback("siteminder-oidc")}.`,
      "Open https://sso.example.com/affwebservices/CASSO/oidc/<client-name>/.well-known/openid-configuration and copy its issuer exactly.",
      testOidc("siteminder-oidc"),
    ],
    examples: [
      {
        title: "necodoc env: SiteMinder over OIDC",
        lang: "env",
        code: `SSO_PROVIDERS=siteminder-oidc
SSO_SITEMINDER_OIDC_TYPE=oidc
SSO_SITEMINDER_OIDC_LABEL=Company sign-in
# Exactly the issuer from the discovery document
SSO_SITEMINDER_OIDC_ISSUER=https://sso.example.com/affwebservices/CASSO/oidc/necodoc
SSO_SITEMINDER_OIDC_DISCOVERY_URL=https://sso.example.com/affwebservices/CASSO/oidc/necodoc/.well-known/openid-configuration
SSO_SITEMINDER_OIDC_CLIENT_ID=FAKE-necodoc-client
SSO_SITEMINDER_OIDC_CLIENT_SECRET=FAKE-client-secret-replace-me
# Add "groups" if the groups claim has its own scope
SSO_SITEMINDER_OIDC_SCOPES=openid email profile
SSO_SITEMINDER_OIDC_ROLE_MAP='{"cn=necodoc-admins,ou=groups,dc=example,dc=com":["admin"]}'`,
      },
    ],
  },
];

export const trustedHeaderGuides: readonly FaqGuide[] = [
  {
    provider: "SiteMinder web agent",
    protocol: "Trusted header",
    steps: [
      "Policy Server › Responses: send SM_EMAIL, SM_DISPLAYNAME and SM_GROUPS as HTTP header variables from user attributes, and attach them to the realm protecting necodoc.",
      "Make sure clients can reach the API only through the web agent: firewall it or bind it to a private network. The agent must strip any SM_ headers clients send (SiteMinder agents do).",
      "With the necodoc-app image (nginx) between the agent and the API, set TRUST_PROXY=true on the API, list the agent's address in TRUSTED_PROXIES, and add underscores_in_headers on; to nginx, which otherwise drops SM_USER.",
      `Test: sign in through the agent at ${app}/login with Sign in with the label. Then, from a machine that isn't a trusted proxy, request /api/sso/header/siteminder-agent with a forged SM_USER header: it must redirect to /login?error=untrusted_proxy.`,
    ],
    examples: [
      {
        title: "necodoc env: SiteMinder trusted header",
        lang: "env",
        code: `SSO_PROVIDERS=siteminder-agent
SSO_SITEMINDER_AGENT_TYPE=header
SSO_SITEMINDER_AGENT_LABEL=Company sign-in
SSO_SITEMINDER_AGENT_HEADER=SM_USER
SSO_SITEMINDER_AGENT_EMAIL_HEADER=SM_EMAIL
SSO_SITEMINDER_AGENT_NAME_HEADER=SM_DISPLAYNAME
SSO_SITEMINDER_AGENT_GROUPS_HEADER=SM_GROUPS
# SiteMinder joins multi-valued responses with ^
SSO_SITEMINDER_AGENT_GROUPS_SEPARATOR=^
# The web agent's addresses (or CIDR ranges), as necodoc sees them
SSO_SITEMINDER_AGENT_TRUSTED_PROXIES=10.20.0.15,10.20.0.16
SSO_SITEMINDER_AGENT_ROLE_MAP='{"necodoc-admins":["admin"],"necodoc-editors":["editor","reviewer"]}'`,
        note: "Without EMAIL_HEADER, the HEADER itself must hold an email. The API logs a warning at every start while this is on.",
      },
      {
        title: "Spoofing check (must be refused)",
        lang: "sh",
        code: `curl -si -H 'SM_USER: admin@example.com' -H 'SM_EMAIL: admin@example.com' \\
  http://necodoc-api.internal:3000/api/sso/header/siteminder-agent | head -3
# HTTP/1.1 302 Found
# Location: /login?error=untrusted_proxy`,
        note: "Run it from somewhere other than the agent. With TRUST_PROXY=true, anyone who can reach the API directly can also forge X-Forwarded-For, so the API must only be reachable from the agent or nginx.",
      },
    ],
  },
];
