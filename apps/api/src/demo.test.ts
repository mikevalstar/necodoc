import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin } from "better-auth/plugins";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  DEMO_EMAIL,
  type DemoLimits,
  dailyCap,
  demoBlockedAuthPath,
  demoGuards,
  demoSession,
  ensureDemoUser,
} from "./demo";

const baseURL = "http://localhost:3000";

function demoAuth() {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: "x".repeat(32),
    baseURL,
    emailAndPassword: { enabled: false },
    plugins: [admin({ defaultRole: "" }), demoSession()],
  });
}

describe("demo session", () => {
  it("creates the demo user once, keyed by email", async () => {
    const auth = demoAuth();
    const context = await auth.$context;
    const first = await ensureDemoUser(context);
    const second = await ensureDemoUser(context);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ email: DEMO_EMAIL, name: "Demo user", role: "admin" });
  });

  it("reuses a demo user someone else created", async () => {
    const auth = demoAuth();
    const context = await auth.$context;
    const seeded = await context.internalAdapter.createUser(
      { email: DEMO_EMAIL, name: "Seeded demo" },
      { method: "admin" },
    );
    expect((await ensureDemoUser(context)).id).toBe(seeded.id);
  });

  it("signs in with a cookie that Better Auth accepts as the demo user", async () => {
    const auth = demoAuth();
    const { headers, response } = await auth.api.demoSignIn({ returnHeaders: true });
    const cookies = headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(response.user.id);
    expect(session?.user.email).toBe(DEMO_EMAIL);
  });

  it("isn't reachable over HTTP", async () => {
    const auth = demoAuth();
    const res = await auth.handler(
      new Request(`${baseURL}/api/auth/demo/sign-in`, { method: "POST" }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

const limits: DemoLimits = {
  rendersPerMinute: 2,
  uploadsPerHour: 1,
  batchesPerHour: 1,
  signInsPerHour: 1,
  aiPerIpPerDay: 2,
  aiPerDay: 3,
  timeZone: "America/Toronto",
};

/** A tiny app behind the guards; the client address comes from X-Ip, the clock from `clock`. */
function guarded(config: DemoLimits | null) {
  const clock = { now: Date.parse("2026-10-12T16:00:00Z") };
  const demo = demoGuards(
    config,
    (c) => c.req.header("X-Ip") ?? "?",
    () => clock.now,
  );
  const app = new Hono()
    .on(["GET", "POST"], "/api/auth/*", demo.authPaths, (c) => c.text("auth"))
    .post("/keys", demo.off, (c) => c.text("created"))
    .post("/render", demo.limit("render"), (c) => c.text("rendered"))
    .post("/upload", demo.limit("upload"), (c) => c.text("uploaded"))
    .get("/me", (c) => demo.signIn(c) ?? c.text("signed in"))
    .post("/ai", (c) => demo.ai(c) ?? c.text("answered"));
  const call = (method: string, path: string, ip = "1.1.1.1") =>
    app.request(path, { method, headers: { "X-Ip": ip } });
  return { call, clock };
}

describe("demo guards", () => {
  it("let everything through when DEMO_MODE is off", async () => {
    const { call } = guarded(null);
    expect((await call("POST", "/keys")).status).toBe(200);
    expect((await call("POST", "/api/auth/admin/create-user")).status).toBe(200);
    for (let i = 0; i < 10; i++) {
      expect((await call("POST", "/render")).status).toBe(200);
      expect((await call("GET", "/me")).status).toBe(200);
      expect((await call("POST", "/ai")).status).toBe(200);
    }
  });

  it("refuse blocked actions with 403 demo_disabled", async () => {
    const { call } = guarded(limits);
    const res = await call("POST", "/keys");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "demo_disabled", error: expect.any(String) });
  });

  it("refuse user and session changes but not reads or impersonation", async () => {
    const { call } = guarded(limits);
    for (const path of [
      "/admin/create-user",
      "/admin/set-role",
      "/admin/ban-user",
      "/admin/remove-user",
      "/admin/set-user-password",
      "/admin/revoke-user-sessions",
      "/update-user",
      "/change-password",
      "/delete-user",
      "/revoke-other-sessions",
    ]) {
      expect(demoBlockedAuthPath(path), path).toBe(true);
      expect((await call("POST", `/api/auth${path}`)).status, path).toBe(403);
    }
    for (const path of [
      "/admin/list-users",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      "/get-session",
      "/sign-out",
    ]) {
      expect(demoBlockedAuthPath(path), path).toBe(false);
      expect((await call("POST", `/api/auth${path}`)).status, path).toBe(200);
    }
  });

  it("limit renders per address with 429 and Retry-After, then refill", async () => {
    const { call, clock } = guarded(limits);
    expect((await call("POST", "/render")).status).toBe(200);
    expect((await call("POST", "/render")).status).toBe(200);
    const limited = await call("POST", "/render");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    expect(await limited.json()).toMatchObject({ code: "demo_rate_limited" });
    // Another address has its own allowance; the first gets a token back after 30 s.
    expect((await call("POST", "/render", "2.2.2.2")).status).toBe(200);
    clock.now += 30_000;
    expect((await call("POST", "/render")).status).toBe(200);
  });

  it("keeps each limit's allowance apart", async () => {
    const { call } = guarded(limits);
    expect((await call("POST", "/upload")).status).toBe(200);
    expect((await call("POST", "/upload")).status).toBe(429);
    expect((await call("POST", "/render")).status).toBe(200);
  });

  it("limit demo sign-ins per address", async () => {
    const { call } = guarded(limits);
    expect((await call("GET", "/me")).status).toBe(200);
    const limited = await call("GET", "/me");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBe(3600);
    expect((await call("GET", "/me", "2.2.2.2")).status).toBe(200);
  });

  it("cap AI per address and in total, until the next day in the demo's zone", async () => {
    const { call, clock } = guarded(limits);
    expect((await call("POST", "/ai")).status).toBe(200);
    expect((await call("POST", "/ai")).status).toBe(200);
    const mine = await call("POST", "/ai");
    expect(mine.status).toBe(429);
    expect((await mine.json()).error).toMatch(/today's 2 AI requests/);
    expect((await call("POST", "/ai", "2.2.2.2")).status).toBe(200);
    const total = await call("POST", "/ai", "3.3.3.3");
    expect(total.status).toBe(429);
    expect((await total.json()).error).toMatch(/allowance for today is used up/);
    // 03:30Z on the 13th is still the 12th in Toronto (EDT); 04:30Z is past its midnight.
    clock.now = Date.parse("2026-10-13T03:30:00Z");
    expect((await call("POST", "/ai", "3.3.3.3")).status).toBe(429);
    clock.now = Date.parse("2026-10-13T04:30:00Z");
    expect((await call("POST", "/ai", "3.3.3.3")).status).toBe(200);
  });
});

describe("dailyCap", () => {
  it("counts per key and in total, and doesn't count refusals", () => {
    const cap = dailyCap({ perKey: 1, total: 2 });
    expect(cap.take("a", "d1")).toBe("ok");
    expect(cap.take("a", "d1")).toBe("key");
    expect(cap.take("b", "d1")).toBe("ok");
    expect(cap.take("c", "d1")).toBe("total");
    expect(cap.take("a", "d2")).toBe("ok");
  });

  it("refuses everything with a cap of zero", () => {
    expect(dailyCap({ perKey: 0, total: 10 }).take("a", "d1")).toBe("key");
  });
});
