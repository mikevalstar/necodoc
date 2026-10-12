import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { DEMO_EMAIL, demoSession, ensureDemoUser } from "./demo";

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
