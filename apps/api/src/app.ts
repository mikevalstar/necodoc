import { parseRoles } from "@necodoc/shared";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./auth";
import type { AppEnv } from "./middleware";

const app = new Hono<AppEnv>().basePath("/api");

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
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      user: { ...user, roles: parseRoles(user.role) },
      impersonatedBy: c.get("session")?.impersonatedBy ?? null,
    });
  });

export type AppType = typeof routes;
export default app;
