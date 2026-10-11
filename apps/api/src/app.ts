import { MAX_FILE_BYTES, parseRoles } from "@necodoc/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { auth } from "./auth";
import type { AppEnv } from "./middleware";
import { assetRoutes } from "./routes/assets";
import { generationRoutes } from "./routes/generations";
import { renderRoutes } from "./routes/render";
import { themeRoutes } from "./routes/themes";

const app = new Hono<AppEnv>().basePath("/api");

app.use(logger());

app.use(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

// ADR 0014: bodies are capped before they're read. The slack covers a 20 MB file's multipart
// envelope; stored files are checked against the exact limit.
app.use(
  bodyLimit({
    maxSize: MAX_FILE_BYTES + 1024 * 1024,
    onError: (c) => c.json({ error: "Request body is over 20 MB" }, 413),
  }),
);

const routes = app
  .get("/health", (c) => c.json({ ok: true }))
  .get("/me", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      user: { ...user, roles: parseRoles(user.role) },
      impersonatedBy: c.get("session")?.impersonatedBy ?? null,
    });
  })
  .route("/render", renderRoutes)
  .route("/themes", themeRoutes)
  .route("/assets", assetRoutes)
  .route("/generations", generationRoutes);

export type AppType = typeof routes;
export default app;
