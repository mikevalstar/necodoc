import { describe, expect, it } from "vitest";
import {
  groupsOf,
  type HeaderProvider,
  mapRoles,
  parseSsoProviders,
  rolesAfterSignIn,
  signInDecision,
  trustedHeaderIdentity,
} from "./sso-config";

const base = "https://necodoc.example.com";

describe("parseSsoProviders", () => {
  it("is empty without SSO_PROVIDERS", () => {
    expect(parseSsoProviders({}, base)).toEqual([]);
  });

  it("reads an OIDC provider with defaults", () => {
    const [entra] = parseSsoProviders(
      {
        SSO_PROVIDERS: "entra",
        SSO_ENTRA_TYPE: "oidc",
        SSO_ENTRA_LABEL: "Microsoft",
        SSO_ENTRA_ISSUER: "https://login.microsoftonline.com/t/v2.0/",
        SSO_ENTRA_CLIENT_ID: "id",
        SSO_ENTRA_CLIENT_SECRET: "secret",
        SSO_ENTRA_ROLE_MAP: '{"admins":["admin"],"writers":"editor,reviewer"}',
      },
      base,
    );
    expect(entra).toMatchObject({
      type: "oidc",
      label: "Microsoft",
      discoveryUrl: "https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration",
      scopes: ["openid", "email", "profile"],
      claims: { email: "email", name: "name", groups: "groups" },
      roleMap: { admins: ["admin"], writers: ["editor", "reviewer"] },
      defaultRoles: [],
      linkExisting: false,
    });
  });

  it("reads a SAML provider, wrapping a bare certificate and deriving the SP entity id", () => {
    const [sm] = parseSsoProviders(
      {
        SSO_PROVIDERS: "siteminder-saml",
        SSO_SITEMINDER_SAML_TYPE: "saml",
        SSO_SITEMINDER_SAML_ENTRY_POINT: "https://sm.example.com/affwebservices/public/saml2sso",
        SSO_SITEMINDER_SAML_IDP_ENTITY_ID: "sm-idp",
        SSO_SITEMINDER_SAML_IDP_CERT: "MIIBhello",
      },
      base,
    );
    expect(sm).toMatchObject({
      type: "saml",
      spEntityId: `${base}/api/auth/sso/saml2/sp/metadata?providerId=siteminder-saml`,
      wantAssertionsSigned: true,
      idp: {
        entityId: "sm-idp",
        cert: "-----BEGIN CERTIFICATE-----\nMIIBhello\n-----END CERTIFICATE-----",
      },
    });
  });

  it("names every bad variable", () => {
    expect(() =>
      parseSsoProviders(
        {
          SSO_PROVIDERS: "a,b,c,BAD",
          SSO_A_TYPE: "oidc",
          SSO_A_ISSUER: "not a url",
          SSO_B_TYPE: "saml",
          SSO_C_TYPE: "header",
          SSO_C_HEADER: "SM_USER",
          SSO_C_ROLE_MAP: '{"x":["owner"]}',
        },
        base,
      ),
    ).toThrow(
      /SSO_A_ISSUER[\s\S]*SSO_A_CLIENT_ID[\s\S]*SSO_B_IDP_METADATA[\s\S]*SSO_C_ROLE_MAP[\s\S]*SSO_C_TRUSTED_PROXIES[\s\S]*"BAD"/,
    );
  });

  it("refuses a header provider without valid proxies, and two header providers", () => {
    const header = (id: string, proxies: string) => ({
      [`SSO_${id}_TYPE`]: "header",
      [`SSO_${id}_HEADER`]: "SM_USER",
      [`SSO_${id}_TRUSTED_PROXIES`]: proxies,
    });
    expect(() =>
      parseSsoProviders({ SSO_PROVIDERS: "h", ...header("H", "10.0.0.0/33") }, base),
    ).toThrow(/TRUSTED_PROXIES/);
    expect(() =>
      parseSsoProviders(
        { SSO_PROVIDERS: "h,i", ...header("H", "10.0.0.1"), ...header("I", "10.0.0.0/8") },
        base,
      ),
    ).toThrow(/only one provider/);
  });
});

describe("mapRoles", () => {
  const provider = {
    roleMap: { Admins: ["admin" as const], Writers: ["editor" as const] },
    defaultRoles: [],
  };

  it("unions mapped roles, matching group names case-insensitively", () => {
    expect(mapRoles(provider, ["writers", "admins", "other"])).toEqual(["admin", "editor"]);
  });

  it("falls back to the default roles, which are none unless configured", () => {
    expect(mapRoles(provider, ["other"])).toEqual([]);
    expect(mapRoles({ ...provider, defaultRoles: ["viewer"] }, [])).toEqual(["viewer"]);
  });
});

describe("rolesAfterSignIn", () => {
  const mapped = { roleMap: { editors: ["editor" as const] }, defaultRoles: [] };
  const unmapped = { roleMap: null, defaultRoles: ["viewer" as const] };

  it("gives new users their mapped roles, plus admin for the very first user", () => {
    expect(rolesAfterSignIn(mapped, ["editors"], { isNew: true, isFirstUser: false })).toEqual([
      "editor",
    ]);
    expect(rolesAfterSignIn(mapped, [], { isNew: true, isFirstUser: true })).toEqual(["admin"]);
    expect(rolesAfterSignIn(unmapped, [], { isNew: true, isFirstUser: false })).toEqual(["viewer"]);
  });

  it("re-syncs existing users only with a role map", () => {
    expect(
      rolesAfterSignIn(mapped, [], {
        isNew: false,
        current: ["editor", "publisher"],
        isLastAdmin: false,
      }),
    ).toEqual([]);
    expect(
      rolesAfterSignIn(unmapped, [], { isNew: false, current: ["publisher"], isLastAdmin: false }),
    ).toBeNull();
  });

  it("never takes admin from the last active admin", () => {
    expect(
      rolesAfterSignIn(mapped, ["editors"], {
        isNew: false,
        current: ["admin"],
        isLastAdmin: true,
      }),
    ).toEqual(["admin", "editor"]);
    expect(
      rolesAfterSignIn(mapped, ["editors"], {
        isNew: false,
        current: ["admin"],
        isLastAdmin: false,
      }),
    ).toEqual(["editor"]);
  });
});

describe("signInDecision", () => {
  const strict = { linkExisting: false, emailDomains: [] };
  const person = { id: "u1", serviceAccount: false };
  const robot = { id: "s1", serviceAccount: true };

  it("signs in the linked user and creates unknown ones", () => {
    expect(signInDecision(strict, "a@x.com", person, null)).toEqual({
      action: "sign-in",
      userId: "u1",
    });
    expect(signInDecision(strict, "a@x.com", null, null)).toEqual({ action: "create" });
  });

  it("doesn't take over an existing account unless the provider allows linking", () => {
    expect(signInDecision(strict, "a@x.com", null, person)).toMatchObject({
      action: "reject",
      code: "account_exists",
    });
    expect(signInDecision({ ...strict, linkExisting: true }, "a@x.com", null, person)).toEqual({
      action: "link",
      userId: "u1",
    });
  });

  it("never signs in a service account, linked or by email", () => {
    const linking = { ...strict, linkExisting: true };
    expect(signInDecision(linking, "a@x.com", robot, null)).toMatchObject({
      code: "service_account",
    });
    expect(signInDecision(linking, "a@x.com", null, robot)).toMatchObject({
      code: "service_account",
    });
  });

  it("enforces email domains", () => {
    const domains = { ...strict, emailDomains: ["x.com"] };
    expect(signInDecision(domains, "a@X.com", null, null)).toEqual({ action: "create" });
    expect(signInDecision(domains, "a@evil.com", person, null)).toMatchObject({
      code: "email_domain",
    });
    expect(signInDecision(domains, "a@sub.x.com", null, null)).toMatchObject({
      code: "email_domain",
    });
  });
});

describe("trustedHeaderIdentity", () => {
  const provider: HeaderProvider = {
    id: "sm",
    label: "SiteMinder",
    type: "header",
    roleMap: null,
    defaultRoles: [],
    linkExisting: false,
    emailDomains: [],
    headers: { user: "SM_USER", email: "SM_EMAIL", groups: "SM_GROUPS" },
    groupsSeparator: "^",
    trustedProxies: ["10.1.0.0/16", "::1"],
  };
  const headers =
    (values: Record<string, string>) =>
    (name: string): string | undefined =>
      values[name];
  const full = headers({ SM_USER: "jdoe", SM_EMAIL: "J.Doe@x.com", SM_GROUPS: "a^ b ^" });

  it("believes the headers from a trusted proxy", () => {
    expect(trustedHeaderIdentity(provider, "10.1.2.3", full)).toEqual({
      ok: true,
      identity: { accountId: "jdoe", email: "j.doe@x.com", name: "j.doe", groups: ["a", "b"] },
    });
    expect(trustedHeaderIdentity(provider, "::ffff:10.1.2.3", full).ok).toBe(true);
    expect(trustedHeaderIdentity(provider, "::1", full).ok).toBe(true);
  });

  it("refuses everyone else, whatever they send", () => {
    for (const peer of ["10.2.0.1", "127.0.0.1", "unknown", ""]) {
      expect(trustedHeaderIdentity(provider, peer, full)).toEqual({
        ok: false,
        status: 403,
        code: "untrusted_proxy",
      });
    }
    expect(trustedHeaderIdentity({ ...provider, trustedProxies: [] }, "10.1.2.3", full).ok).toBe(
      false,
    );
  });

  it("needs a user and a valid email", () => {
    expect(
      trustedHeaderIdentity(provider, "10.1.2.3", headers({ SM_EMAIL: "a@x.com" })),
    ).toMatchObject({
      code: "no_identity",
    });
    expect(
      trustedHeaderIdentity(provider, "10.1.2.3", headers({ SM_USER: "jdoe", SM_EMAIL: "jdoe" })),
    ).toMatchObject({ code: "no_email" });
  });
});

describe("groupsOf", () => {
  it("keeps a lone claim string whole, and splits headers", () => {
    expect(groupsOf("cn=admins,ou=groups")).toEqual(["cn=admins,ou=groups"]);
    expect(groupsOf(["a", 3, " b "])).toEqual(["a", "b"]);
    expect(groupsOf("a^b", "^")).toEqual(["a", "b"]);
    expect(groupsOf(undefined)).toEqual([]);
  });
});
