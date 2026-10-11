import { isIP } from "node:net";
import { type Role, roleSchema } from "@necodoc/shared";
import { z } from "zod";
import { ipAllowed } from "./addresses";

// ADR 0031, docs/features/single-sign-on.md. Identity providers from env: SSO_PROVIDERS lists ids,
// each id's settings are SSO_<ID>_* variables. Kept free of the database and Better Auth so it's
// unit-tested (sso-config.test.ts).

/** Unset and blank both mean "not set". */
const optional = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);
/** Comma (or space) separated; blank is an empty list. */
const list = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
const roleList = list.pipe(z.array(roleSchema));
const bool = (fallback: boolean) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.stringbool().default(fallback));

/** `{"necodoc-admins":["admin"],"editors":"editor,reviewer"}`. Group names are matched case-insensitively. */
const roleMap = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: 'must be JSON, like {"group":["admin"]}' });
        return z.NEVER;
      }
    })
    .pipe(
      z.record(
        z.string().min(1),
        z.union([z.array(roleSchema), roleList]).transform((roles) => [...new Set(roles)]),
      ),
    )
    .optional(),
);

/** A PEM certificate: real newlines, `\n` escapes (one-line env values) or the bare base64 body. */
const pem = optional.transform((value) => {
  if (!value) return undefined;
  const text = value.replaceAll("\\n", "\n").trim();
  if (text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----`;
});

const cidr = z.string().refine((entry) => {
  const [net = "", prefix, extra] = entry.split("/");
  const family = isIP(net);
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return Number.isInteger(bits) && bits >= 0 && bits <= (family === 6 ? 128 : 32);
}, "must be an IP address or CIDR range");

const common = {
  LABEL: optional,
  /** When set, roles are recomputed from the IdP's groups at every sign-in. */
  ROLE_MAP: roleMap,
  /** Roles for users in no mapped group (and new users when there's no map). Default: none, pending. */
  DEFAULT_ROLES: roleList,
  /** Let this IdP sign in as an existing necodoc user with the same email. */
  LINK_EXISTING: bool(false),
  /** Refuse emails outside these domains. Empty allows any. */
  EMAIL_DOMAINS: list.transform((domains) => domains.map((d) => d.toLowerCase().replace(/^@/, ""))),
};

const oidc = z.object({
  TYPE: z.literal("oidc"),
  ...common,
  /** e.g. https://login.microsoftonline.com/<tenant>/v2.0 */
  ISSUER: z.url(),
  /** Default: <issuer>/.well-known/openid-configuration */
  DISCOVERY_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  CLIENT_ID: z.string().min(1),
  CLIENT_SECRET: z.string().min(1),
  SCOPES: list.transform((scopes) => (scopes.length ? scopes : ["openid", "email", "profile"])),
  EMAIL_CLAIM: optional.default("email"),
  NAME_CLAIM: optional.default("name"),
  GROUPS_CLAIM: optional.default("groups"),
});

const saml = z
  .object({
    TYPE: z.literal("saml"),
    ...common,
    /** The IdP's single sign-on URL (HTTP-Redirect binding). Not needed with IDP_METADATA. */
    ENTRY_POINT: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
    IDP_ENTITY_ID: optional,
    IDP_CERT: pem,
    /** The IdP's metadata XML, instead of ENTRY_POINT, IDP_ENTITY_ID and IDP_CERT. */
    IDP_METADATA: optional,
    /** Default: this provider's SP metadata URL. */
    SP_ENTITY_ID: optional,
    NAMEID_FORMAT: optional.default("urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"),
    EMAIL_ATTRIBUTE: optional.default("email"),
    NAME_ATTRIBUTE: optional.default("displayName"),
    GROUPS_ATTRIBUTE: optional.default("groups"),
    WANT_ASSERTIONS_SIGNED: bool(true),
  })
  .refine((e) => e.IDP_METADATA || (e.ENTRY_POINT && e.IDP_ENTITY_ID && e.IDP_CERT), {
    message: "set IDP_METADATA, or all of ENTRY_POINT, IDP_ENTITY_ID and IDP_CERT",
    path: ["IDP_METADATA"],
  });

const header = z.object({
  TYPE: z.literal("header"),
  ...common,
  /** The user's id, set by the proxy, e.g. SM_USER. */
  HEADER: z.string().regex(/^[\w-]+$/, "must be a header name"),
  /** Default: HEADER, which then has to hold an email. */
  EMAIL_HEADER: optional,
  NAME_HEADER: optional,
  GROUPS_HEADER: optional,
  GROUPS_SEPARATOR: optional.default(","),
  /** Only requests from these addresses (the proxy) are believed. Required. */
  TRUSTED_PROXIES: list.pipe(z.array(cidr).min(1, "list the proxy's addresses or CIDR ranges")),
});

const providerSchema = z.discriminatedUnion("TYPE", [oidc, saml, header]);

type Common = {
  id: string;
  label: string;
  roleMap: Record<string, Role[]> | null;
  defaultRoles: Role[];
  linkExisting: boolean;
  emailDomains: string[];
};
export type OidcProvider = Common & {
  type: "oidc";
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  claims: { email: string; name: string; groups: string };
};
export type SamlProvider = Common & {
  type: "saml";
  idp: { metadata: string } | { entryPoint: string; entityId: string; cert: string };
  spEntityId: string;
  nameIdFormat: string;
  attributes: { email: string; name: string; groups: string };
  wantAssertionsSigned: boolean;
};
export type HeaderProvider = Common & {
  type: "header";
  headers: { user: string; email: string; name?: string; groups?: string };
  groupsSeparator: string;
  trustedProxies: string[];
};
export type SsoProvider = OidcProvider | SamlProvider | HeaderProvider;

/** SSO_<ID>_ prefix for a provider id: `auth0-saml` → `SSO_AUTH0_SAML_`. */
const prefixOf = (id: string) => `SSO_${id.toUpperCase().replaceAll("-", "_")}_`;

/** Parses SSO_PROVIDERS and each provider's SSO_<ID>_* variables. Throws naming every bad variable. */
export function parseSsoProviders(
  source: Record<string, string | undefined>,
  baseUrl: string,
): SsoProvider[] {
  const ids = list.parse(source.SSO_PROVIDERS);
  const errors: string[] = [];
  const providers: SsoProvider[] = [];
  for (const id of new Set(ids)) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) {
      errors.push(`SSO_PROVIDERS: "${id}" must be lowercase letters, digits and dashes`);
      continue;
    }
    const prefix = prefixOf(id);
    const vars = Object.fromEntries(
      Object.entries(source)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
    const parsed = providerSchema.safeParse(vars);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${prefix}${issue.path.join(".") || "TYPE"}: ${issue.message}`);
      }
      continue;
    }
    providers.push(toProvider(id, parsed.data, baseUrl));
  }
  if (providers.filter((p) => p.type === "header").length > 1) {
    errors.push("SSO_PROVIDERS: only one provider can have TYPE=header");
  }
  if (errors.length) throw new Error(`Invalid SSO configuration:\n  ${errors.join("\n  ")}`);
  return providers;
}

function toProvider(id: string, e: z.infer<typeof providerSchema>, baseUrl: string): SsoProvider {
  const base: Common = {
    id,
    label: e.LABEL ?? id,
    roleMap: e.ROLE_MAP ?? null,
    defaultRoles: e.DEFAULT_ROLES,
    linkExisting: e.LINK_EXISTING,
    emailDomains: e.EMAIL_DOMAINS,
  };
  switch (e.TYPE) {
    case "oidc":
      return {
        ...base,
        type: "oidc",
        issuer: e.ISSUER,
        discoveryUrl:
          e.DISCOVERY_URL ?? `${e.ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`,
        clientId: e.CLIENT_ID,
        clientSecret: e.CLIENT_SECRET,
        scopes: e.SCOPES,
        claims: { email: e.EMAIL_CLAIM, name: e.NAME_CLAIM, groups: e.GROUPS_CLAIM },
      };
    case "saml":
      return {
        ...base,
        type: "saml",
        idp: e.IDP_METADATA
          ? { metadata: e.IDP_METADATA.replaceAll("\\n", "\n") }
          : // The refine above guarantees all three.
            {
              entryPoint: e.ENTRY_POINT ?? "",
              entityId: e.IDP_ENTITY_ID ?? "",
              cert: e.IDP_CERT ?? "",
            },
        spEntityId:
          e.SP_ENTITY_ID ??
          `${baseUrl.replace(/\/$/, "")}/api/auth/sso/saml2/sp/metadata?providerId=${id}`,
        nameIdFormat: e.NAMEID_FORMAT,
        attributes: {
          email: e.EMAIL_ATTRIBUTE,
          name: e.NAME_ATTRIBUTE,
          groups: e.GROUPS_ATTRIBUTE,
        },
        wantAssertionsSigned: e.WANT_ASSERTIONS_SIGNED,
      };
    case "header":
      return {
        ...base,
        type: "header",
        headers: {
          user: e.HEADER,
          email: e.EMAIL_HEADER ?? e.HEADER,
          name: e.NAME_HEADER,
          groups: e.GROUPS_HEADER,
        },
        groupsSeparator: e.GROUPS_SEPARATOR,
        trustedProxies: e.TRUSTED_PROXIES,
      };
  }
}

/**
 * A claim, attribute or header value as a list of group names. Claims and attributes are lists
 * already (a lone string is one group: LDAP DNs contain commas); headers split on `separator`.
 */
export function groupsOf(value: unknown, separator?: string): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? separator
        ? value.split(separator)
        : [value]
      : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((group) => group.trim())
    .filter(Boolean);
}

/** Roles from a provider's map for these groups, in role order; the default roles when none match. */
export function mapRoles(
  provider: Pick<Common, "roleMap" | "defaultRoles">,
  groups: readonly string[],
) {
  const wanted = new Set(groups.map((g) => g.toLowerCase()));
  const mapped = new Set(
    Object.entries(provider.roleMap ?? {})
      .filter(([group]) => wanted.has(group.toLowerCase()))
      .flatMap(([, roles]) => roles),
  );
  return ordered(mapped.size ? mapped : provider.defaultRoles);
}

/** Deduplicated, in roleSchema order. */
function ordered(roles: Iterable<Role>): Role[] {
  const set = new Set(roles);
  return roleSchema.options.filter((role) => set.has(role));
}

export function emailAllowed(provider: Pick<Common, "emailDomains">, email: string) {
  if (!provider.emailDomains.length) return true;
  const domain = email.toLowerCase().split("@").at(-1) ?? "";
  return email.includes("@") && provider.emailDomains.includes(domain);
}

type Candidate = { id: string; serviceAccount: boolean | null } | null;
export type SignInDecision =
  | { action: "sign-in" | "link"; userId: string }
  | { action: "create" }
  | { action: "reject"; code: string; message: string };

/**
 * Who an IdP identity signs in as. `linked` owns this provider identity already; `byEmail` has the
 * same email. An IdP never takes over an existing account unless the provider allows linking, and
 * service accounts never sign in (ADR 0029).
 */
export function signInDecision(
  provider: Pick<Common, "linkExisting" | "emailDomains">,
  email: string,
  linked: Candidate,
  byEmail: Candidate,
): SignInDecision {
  if (!emailAllowed(provider, email)) {
    return {
      action: "reject",
      code: "email_domain",
      message: "Your email domain can't sign in here.",
    };
  }
  const user = linked ?? byEmail;
  if (user?.serviceAccount) {
    return {
      action: "reject",
      code: "service_account",
      message: "Service accounts can't sign in.",
    };
  }
  if (linked) return { action: "sign-in", userId: linked.id };
  if (!byEmail) return { action: "create" };
  if (provider.linkExisting) return { action: "link", userId: byEmail.id };
  return {
    action: "reject",
    code: "account_exists",
    message:
      "An account with your email already exists. Ask an admin to link it to single sign-on.",
  };
}

/**
 * Roles to store after an SSO sign-in, or null to leave them. New users get the mapped (or
 * default) roles, plus admin when they're the very first user. Existing users are re-synced only
 * when the provider has a role map, and the last active admin keeps admin.
 */
export function rolesAfterSignIn(
  provider: Pick<Common, "roleMap" | "defaultRoles">,
  groups: readonly string[],
  user:
    | { isNew: true; isFirstUser: boolean }
    | { isNew: false; current: readonly Role[]; isLastAdmin: boolean },
): Role[] | null {
  const mapped = mapRoles(provider, groups);
  if (user.isNew) return user.isFirstUser ? ordered(["admin", ...mapped]) : mapped;
  if (!provider.roleMap) return null;
  const keepAdmin = user.isLastAdmin && user.current.includes("admin");
  return keepAdmin ? ordered(["admin", ...mapped]) : mapped;
}

export type HeaderIdentity = { accountId: string; email: string; name: string; groups: string[] };

/**
 * Trusted-header mode: the identity in the proxy's headers, believed only when the request's peer
 * address (see clientIp) is one of the provider's trusted proxies.
 */
export function trustedHeaderIdentity(
  provider: HeaderProvider,
  peer: string,
  header: (name: string) => string | undefined,
): { ok: true; identity: HeaderIdentity } | { ok: false; status: 400 | 401 | 403; code: string } {
  if (!provider.trustedProxies.length || !ipAllowed(provider.trustedProxies, peer)) {
    return { ok: false, status: 403, code: "untrusted_proxy" };
  }
  const accountId = header(provider.headers.user)?.trim();
  if (!accountId) return { ok: false, status: 401, code: "no_identity" };
  const email = z.email().safeParse(header(provider.headers.email)?.trim().toLowerCase());
  if (!email.success) return { ok: false, status: 400, code: "no_email" };
  const name = provider.headers.name ? header(provider.headers.name)?.trim() : undefined;
  const groups = provider.headers.groups ? header(provider.headers.groups) : undefined;
  return {
    ok: true,
    identity: {
      accountId,
      email: email.data,
      name: name || email.data.split("@")[0] || email.data,
      groups: groupsOf(groups, provider.groupsSeparator),
    },
  };
}
