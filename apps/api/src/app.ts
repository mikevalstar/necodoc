import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./auth";

type Variables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const app = new Hono<{ Variables: Variables }>().basePath("/api");

app.use(logger());

app.use(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .get("/me", (c) => {
    const user = c.get("user");
    return user ? c.json({ user }) : c.json({ error: "Unauthorized" }, 401);
  });

export type AppType = typeof routes;
export default app;
