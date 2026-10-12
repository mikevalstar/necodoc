import { zValidator } from "@hono/zod-validator";
import { type SignInOptions, safeReturnPath, signInMethodsQuerySchema } from "@necodoc/shared";
import { APIError } from "better-auth/api";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { recordAudit } from "../audit";
import { auth } from "../auth";
import { db } from "../db";
import { account } from "../db/schema";
import { env, ssoProviders } from "../env";
import { log } from "../log";
import { type AppEnv, clientIp, requireRole } from "../middleware";
import { trustedHeaderIdentity } from "../sso-config";

// ADR 0031, docs/features/single-sign-on.md. OIDC and SAML themselves run under /api/auth/sso
// (the Better Auth plugin); these are the parts it doesn't cover.

const labels = new Map(ssoProviders.map((p) => [p.id, p.label]));

export const ssoRoutes = new Hono<AppEnv>()
  // Public: the login page asks before anyone is signed in.
  .get("/options", (c) =>
    c.json({
      password: env.AUTH_PASSWORD_ENABLED,
      providers: ssoProviders.map(({ id, label, type }) => ({ id, label, type })),
    } satisfies SignInOptions),
  )
  // Trusted-header mode: the browser comes here through the proxy, which set the identity headers.
  .get("/header/:id", async (c) => {
    const provider = ssoProviders.find((p) => p.id === c.req.param("id"));
    if (provider?.type !== "header") return c.json({ error: "Not found" }, 404);
    // ?redirect=: the page the login page was asked for; same-origin paths only.
    const returnTo = safeReturnPath(c.req.query("redirect"));
    const loginWith = (error: string) =>
      `/login?${new URLSearchParams({ error, ...(returnTo && { redirect: returnTo }) })}`;
    const peer = clientIp(c);
    const result = trustedHeaderIdentity(provider, peer, (name) => c.req.header(name));
    const via = { method: "trusted_header", provider: provider.id } as const;
    const failed = (email: string | null, reason: string) =>
      recordAudit({
        action: "auth.sign_in_failed",
        target: { id: null, name: email },
        details: { ...via, email, reason },
      });
    if (!result.ok) {
      log.warn(
        { provider: provider.id, peer, code: result.code },
        `SSO ${provider.id}: refused header sign-in from ${peer} (${result.code})`,
      );
      await failed(null, result.code);
      return c.redirect(loginWith(result.code));
    }
    try {
      const { headers, response: signedIn } = await auth.api.trustedHeaderSignIn({
        body: { providerId: provider.id, identity: result.identity },
        returnHeaders: true,
      });
      await recordAudit({
        action: "auth.signed_in",
        target: { id: signedIn.userId, name: result.identity.email },
        actor: { kind: "user", id: signedIn.userId, name: result.identity.name },
        details: via,
      });
      const response = c.redirect(returnTo ?? "/");
      for (const cookie of headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
      return response;
    } catch (error) {
      if (!(error instanceof APIError)) throw error;
      const code = typeof error.body?.code === "string" ? error.body.code : "sign_in_failed";
      await failed(result.identity.email, code);
      return c.redirect(loginWith(code));
    }
  })
  // Admin › Users: how each listed user signs in.
  .get(
    "/sign-in-methods",
    requireRole("admin"),
    zValidator("query", signInMethodsQuerySchema),
    async (c) => {
      const { ids } = c.req.valid("query");
      const rows = ids.length
        ? await db
            .select({ userId: account.userId, providerId: account.providerId })
            .from(account)
            .where(inArray(account.userId, ids))
        : [];
      const methods: Record<string, string[]> = {};
      for (const { userId, providerId } of rows) {
        const method =
          providerId === "credential" ? "Password" : (labels.get(providerId) ?? providerId);
        methods[userId] = [...(methods[userId] ?? []), method];
      }
      return c.json(methods);
    },
  );
