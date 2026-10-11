import { type SSOOptions, sso } from "@better-auth/sso";
import { parseRoles } from "@necodoc/shared";
import type { BetterAuthPlugin, DBTransactionAdapter } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { recordAudit } from "./audit";
import { env, ssoProviders } from "./env";
import {
  groupsOf,
  type HeaderIdentity,
  type OidcProvider,
  rolesAfterSignIn,
  type SamlProvider,
  type SsoProvider,
  signInDecision,
} from "./sso-config";
import { activeAdminIds } from "./users";

// ADR 0031, docs/features/single-sign-on.md: OIDC and SAML through @better-auth/sso with providers
// from env, and trusted-header mode. necodoc decides who signs in (provision below); Better Auth
// verifies the protocol and keeps sessions.

type UserRow = { id: string; role: string | null; serviceAccount: boolean | null };

/**
 * Finds or creates the user for a verified identity and syncs their roles, inside the caller's
 * transaction. "link" means the identity isn't attached to the user yet.
 */
async function provision(
  database: DBTransactionAdapter,
  provider: SsoProvider,
  who: HeaderIdentity,
) {
  const findUser = (field: "id" | "email", value: string) =>
    database.findOne<UserRow>({ model: "user", where: [{ field, value }] });
  const account = await database.findOne<{ userId: string }>({
    model: "account",
    where: [
      { field: "providerId", value: provider.id },
      { field: "accountId", value: who.accountId },
    ],
  });
  const linked = account ? await findUser("id", account.userId) : null;
  const byEmail = linked ? null : await findUser("email", who.email);
  const decision = signInDecision(provider, who.email, linked, byEmail);
  if (decision.action === "reject") {
    console.warn(`SSO ${provider.id}: refused ${who.email} (${decision.code})`);
    return decision;
  }

  if (decision.action === "create") {
    const isFirstUser = (await database.count({ model: "user" })) === 0;
    const roles = rolesAfterSignIn(provider, who.groups, { isNew: true, isFirstUser });
    const now = new Date();
    const created = await database.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: {
        name: who.name,
        email: who.email,
        emailVerified: false,
        role: roles?.join(",") ?? "",
        serviceAccount: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    // Written on our own connection, not in the sign-in transaction (ADR 0032).
    await recordAudit({
      action: "user.created",
      target: { id: created.id, name: who.email },
      actor: { kind: "system", id: null, name: null },
      after: { name: who.name, email: who.email, role: roles ?? [] },
      details: { via: "sso", provider: provider.id, groups: who.groups },
    });
    console.info(`SSO ${provider.id}: created ${who.email} with roles [${roles?.join(", ")}]`);
    return { action: "link" as const, userId: created.id };
  }

  const user = linked ?? byEmail;
  if (!user) throw new Error("unreachable: sign-in decision without a user");
  const current = parseRoles(user.role);
  const isLastAdmin =
    provider.roleMap !== null &&
    current.includes("admin") &&
    [...(await activeAdminIds())].every((id) => id === user.id);
  const roles = rolesAfterSignIn(provider, who.groups, { isNew: false, current, isLastAdmin });
  if (roles && roles.join(",") !== current.join(",")) {
    await database.update({
      model: "user",
      where: [{ field: "id", value: user.id }],
      update: { role: roles.join(","), updatedAt: new Date() },
    });
    await recordAudit({
      action: "user.role_changed",
      target: { id: user.id, name: who.email },
      actor: { kind: "system", id: null, name: null },
      before: { role: current },
      after: { role: roles },
      details: { via: "sso", provider: provider.id, groups: who.groups },
    });
    console.info(`SSO ${provider.id}: ${who.email} roles [${current}] -> [${roles}]`);
  }
  return decision;
}

const resolveUser: NonNullable<SSOOptions["resolveUser"]> = async (input, { database }) => {
  const provider = ssoProviders.find((p) => p.id === input.providerId);
  if (!provider || provider.type === "header") {
    return { action: "reject", code: "unknown_provider" };
  }
  // OIDC groups usually live in the ID token (Entra doesn't put them in UserInfo).
  const groups =
    input.protocol === "oidc" && provider.type === "oidc"
      ? (input.verifiedIdTokenClaims[provider.claims.groups] ??
        input.providerClaims[provider.claims.groups])
      : input.protocol === "saml" && provider.type === "saml"
        ? input.providerAttributes[provider.attributes.groups]
        : undefined;
  const email = input.providerUser.email.toLowerCase();
  const result = await provision(database, provider, {
    accountId: input.accountKey.accountId,
    email,
    name: input.providerUser.name || email,
    groups: groupsOf(groups),
  });
  if (result.action === "reject") return result;
  return { action: "link", userId: result.userId, profile: "preserve" };
};

const appUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

type ConfiguredProvider = NonNullable<SSOOptions["defaultSSO"]>[number];

function oidcConfig(p: OidcProvider): ConfiguredProvider {
  return {
    domain: p.emailDomains[0] ?? "",
    providerId: p.id,
    oidcConfig: {
      issuer: p.issuer,
      discoveryEndpoint: p.discoveryUrl,
      pkce: true,
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      scopes: p.scopes,
      mapping: { email: p.claims.email, name: p.claims.name },
    },
  };
}

function samlConfig(p: SamlProvider): ConfiguredProvider {
  const idp = p.idp;
  return {
    domain: p.emailDomains[0] ?? "",
    providerId: p.id,
    samlConfig: {
      issuer: p.spEntityId,
      entryPoint: "entryPoint" in idp ? idp.entryPoint : "",
      callbackUrl: `${appUrl}/`,
      idpMetadata:
        "metadata" in idp
          ? { metadata: idp.metadata }
          : {
              entityID: idp.entityId,
              cert: idp.cert,
              singleSignOnService: [
                {
                  Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
                  Location: idp.entryPoint,
                },
              ],
            },
      spMetadata: { entityID: p.spEntityId },
      wantAssertionsSigned: p.wantAssertionsSigned,
      identifierFormat: p.nameIdFormat,
      mapping: { email: p.attributes.email, name: p.attributes.name },
    },
  };
}

/**
 * Trusted-header sign-in. SERVER_ONLY: it isn't routed over HTTP; routes/sso.ts calls it after
 * checking the request came from a trusted proxy.
 */
const trustedHeader = {
  id: "necodoc-trusted-header",
  endpoints: {
    trustedHeaderSignIn: createAuthEndpoint(
      "/necodoc/trusted-header-sign-in",
      {
        method: "POST",
        body: z.object({
          providerId: z.string(),
          identity: z.object({
            accountId: z.string().min(1),
            email: z.email(),
            name: z.string(),
            groups: z.array(z.string()),
          }),
        }),
        metadata: { SERVER_ONLY: true },
      },
      async (ctx) => {
        const provider = ssoProviders.find((p) => p.id === ctx.body.providerId);
        if (provider?.type !== "header")
          throw APIError.from("NOT_FOUND", {
            message: "No such provider",
            code: "unknown_provider",
          });
        const { identity } = ctx.body;
        const result = await ctx.context.adapter.transaction(async (tx) => {
          const decision = await provision(tx, provider, identity);
          if (decision.action === "link") {
            const now = new Date();
            await tx.create({
              model: "account",
              data: {
                userId: decision.userId,
                providerId: provider.id,
                accountId: identity.accountId,
                createdAt: now,
                updatedAt: now,
              },
            });
          }
          return decision;
        });
        if (result.action === "reject") {
          throw APIError.from("FORBIDDEN", { message: result.message, code: result.code });
        }
        // The session hooks still apply: banned users and service accounts are refused here.
        const session = await ctx.context.internalAdapter.createSession(result.userId);
        const user = await ctx.context.internalAdapter.findUserById(result.userId);
        if (!user)
          throw APIError.from("NOT_FOUND", { message: "User not found", code: "user_not_found" });
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ userId: user.id });
      },
    ),
  },
} satisfies BetterAuthPlugin;

const headerProvider = ssoProviders.find((p) => p.type === "header");
if (headerProvider?.type === "header") {
  console.warn(
    `\n!!! TRUSTED-HEADER SIGN-IN IS ON (SSO provider "${headerProvider.id}").\n` +
      `!!! Anyone who can reach the API from ${headerProvider.trustedProxies.join(", ")} can sign in as anyone by\n` +
      `!!! sending ${headerProvider.headers.user}. The proxy must strip that header from client requests.\n`,
  );
}

const protocolProviders = ssoProviders.flatMap((p): ConfiguredProvider[] =>
  p.type === "oidc" ? [oidcConfig(p)] : p.type === "saml" ? [samlConfig(p)] : [],
);

export const ssoPlugins = [
  sso({
    defaultSSO: protocolProviders,
    resolveUser,
    // ADR 0031: providers come from env only.
    providersLimit: 0,
    saml: { allowIdpInitiated: false, requireTimestamps: true },
  }),
  trustedHeader,
];

/** The plugin fetches OIDC discovery documents only from trusted origins. */
export const ssoTrustedOrigins = ssoProviders.flatMap((p) =>
  p.type === "oidc" ? [new URL(p.discoveryUrl).origin] : [],
);

/** Its provider-management endpoints: never reachable over HTTP. */
export const ssoDisabledPaths = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];
