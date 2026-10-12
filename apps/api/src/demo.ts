import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { tokenBucket } from "./rate-limit";

// Spec: docs/features/public-demo.md, ADRs 0044 and 0046. In DEMO_MODE every visitor without a
// session is signed in as one shared demo user, and the guards below refuse or limit what could
// harm the instance. Kept free of the database and env so it's tested without them
// (demo.test.ts); middleware.ts builds the guards from env.

export const DEMO_EMAIL = "demo@necodoc.com";

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
        // Every visitor is an admin so every page shows; the guards below refuse the harmful parts.
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

// ---------------------------------------------------------------------------------------------
// Hardening (ADR 0046)

/** Why a control is off; the app shows the same words (components/demo-lock.tsx). */
export const DEMO_DISABLED = "Turned off in the public demo.";

/** From env (DEMO_*); null when DEMO_MODE is off and every guard lets everything through. */
export type DemoLimits = {
  rendersPerMinute: number;
  uploadsPerHour: number;
  batchesPerHour: number;
  signInsPerHour: number;
  aiPerIpPerDay: number;
  aiPerDay: number;
  /** Where AI days start and end: DEMO_RESET_TZ. */
  timeZone: string;
};

export type DemoLimit = "render" | "upload" | "batch";

/** Admin plugin endpoints that only read, or impersonate (which changes no one's account). */
const adminAllowed = new Set([
  "/admin/list-users",
  "/admin/get-user",
  "/admin/has-permission",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
]);
/** The shared account's own profile, password, sessions and deletion: everyone's at once. */
const selfBlocked = new Set([
  "/update-user",
  "/change-email",
  "/change-password",
  "/set-password",
  "/delete-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/unlink-account",
]);

/** Whether a Better Auth path (under /api/auth) is refused in the demo. */
export function demoBlockedAuthPath(path: string) {
  return path.startsWith("/admin/") ? !adminAllowed.has(path) : selfBlocked.has(path);
}

/**
 * A count per key and in total that starts again when `day` changes. In memory: the demo runs
 * one API process, and the nightly reset restarts it.
 */
export function dailyCap({ perKey, total }: { perKey: number; total: number }) {
  let current = "";
  let used = 0;
  const byKey = new Map<string, number>();
  return {
    /** Counts one use, or says which cap is reached without counting it. */
    take(key: string, day: string): "ok" | "key" | "total" {
      if (day !== current) {
        current = day;
        used = 0;
        byKey.clear();
      }
      const mine = byKey.get(key) ?? 0;
      if (mine >= perKey) return "key";
      if (used >= total) return "total";
      byKey.set(key, mine + 1);
      used++;
      return "ok";
    },
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const wait = (ms: number) =>
  ms >= 2 * MINUTE
    ? count(Math.ceil(ms / MINUTE), "minute")
    : count(Math.ceil(ms / 1000), "second");

/**
 * The demo's guards. With `limits` null (DEMO_MODE off) every check passes. `ip` is the client
 * address (clientIp); `now` is for tests.
 */
export function demoGuards(
  limits: DemoLimits | null,
  ip: (c: Context) => string,
  now: () => number = Date.now,
) {
  const bucket = (count: number, per: number) =>
    tokenBucket({ capacity: Math.max(1, count), refillMs: per / Math.max(1, count) });
  const buckets = limits && {
    render: bucket(limits.rendersPerMinute, MINUTE),
    upload: bucket(limits.uploadsPerHour, HOUR),
    batch: bucket(limits.batchesPerHour, HOUR),
    signIn: bucket(limits.signInsPerHour, HOUR),
  };
  const what = limits && {
    render: `${limits.rendersPerMinute} renders a minute`,
    upload: `${limits.uploadsPerHour} uploads an hour`,
    batch: `${limits.batchesPerHour} batches an hour`,
  };
  const ai = limits && dailyCap({ perKey: limits.aiPerIpPerDay, total: limits.aiPerDay });
  const day = limits && new Intl.DateTimeFormat("en-CA", { timeZone: limits.timeZone });

  const tooMany = (c: Context, error: string, retryAfterMs?: number) => {
    if (retryAfterMs !== undefined) c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return c.json({ error, code: "demo_rate_limited" }, 429);
  };

  /** 403 for an action the demo refuses. `message` keeps Better Auth's client showing it. */
  const refuse = (c: Context) =>
    c.json({ error: DEMO_DISABLED, message: DEMO_DISABLED, code: "demo_disabled" }, 403);

  return {
    /** Middleware: the action is refused in the demo. */
    off: createMiddleware(async (c, next) => (limits ? refuse(c) : next())),

    /** Middleware for /api/auth/*: refuses user and session changes (demoBlockedAuthPath). */
    authPaths: createMiddleware(async (c, next) =>
      limits && demoBlockedAuthPath(c.req.path.replace(/^\/api\/auth/, "")) ? refuse(c) : next(),
    ),

    /** Middleware: one request against the address's render, upload or batch allowance. */
    limit: (kind: DemoLimit) =>
      createMiddleware(async (c, next) => {
        if (!buckets || !what) return next();
        const taken = buckets[kind].take(ip(c), now());
        if (taken.ok) return next();
        return tooMany(
          c,
          `The public demo allows ${what[kind]} from one address. Try again in ${wait(taken.retryAfterMs)}.`,
          taken.retryAfterMs,
        );
      }),

    /** Before creating a demo session: a 429 to answer instead, or null to go ahead. */
    signIn(c: Context) {
      if (!buckets) return null;
      const taken = buckets.signIn.take(ip(c), now());
      if (taken.ok) return null;
      return tooMany(
        c,
        `Too many demo sign-ins from your address. Try again in ${wait(taken.retryAfterMs)}.`,
        taken.retryAfterMs,
      );
    },

    /** Before an AI request: a 429 when a daily cap is reached, or null to go ahead. */
    ai(c: Context) {
      if (!limits || !ai || !day) return null;
      const taken = ai.take(ip(c), day.format(now()));
      if (taken === "ok") return null;
      return tooMany(
        c,
        taken === "key"
          ? `You've used today's ${limits.aiPerIpPerDay} AI requests in the public demo. They come back after the nightly reset.`
          : "The public demo's AI allowance for today is used up. It comes back after the nightly reset.",
      );
    },
  };
}
