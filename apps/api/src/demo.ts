import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

// Spec: docs/features/public-demo.md, ADR 0044. In DEMO_MODE every visitor without a session is
// signed in as one shared demo user. Kept free of the database and env so it's tested against
// an in-memory Better Auth (demo.test.ts). W11 hardening (caps, per-visitor accounts) goes here.

export const DEMO_EMAIL = "demo@necodocs.com";

type Users = Pick<
  Parameters<NonNullable<BetterAuthPlugin["init"]>>[0]["internalAdapter"],
  "findUserByEmail" | "createUser"
>;

/** Find or create the demo user, keyed by email, so a seed may create or wipe it too. */
export async function ensureDemoUser({ internalAdapter }: { internalAdapter: Users }) {
  const found = await internalAdapter.findUserByEmail(DEMO_EMAIL);
  if (found) return found.user;
  try {
    return await internalAdapter.createUser(
      {
        email: DEMO_EMAIL,
        name: "Demo user",
        emailVerified: true,
        // Known risk until W11 hardening: every visitor is an admin (docs/features/public-demo.md).
        role: "admin",
      },
      { method: "demo" },
    );
  } catch (error) {
    // Another request created it first.
    const created = await internalAdapter.findUserByEmail(DEMO_EMAIL);
    if (created) return created.user;
    throw error;
  }
}

/**
 * `auth.api.demoSignIn`: a session for the demo user, with its cookie set. SERVER_ONLY keeps it
 * off Better Auth's HTTP router; GET /api/me calls it (app.ts).
 */
export const demoSession = () =>
  ({
    id: "demo-session",
    endpoints: {
      demoSignIn: createAuthEndpoint(
        "/demo/sign-in",
        { method: "POST", metadata: { SERVER_ONLY: true } },
        async (ctx) => {
          const user = await ensureDemoUser(ctx.context);
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user, session });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
