import { MAX_FILE_BYTES, parseRoles } from "@necodoc/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { aiModel } from "./ai";
import { auditScope } from "./audit";
import { auth } from "./auth";
import { demoResetting } from "./demo-reset";
import { env, instance } from "./env";
import { type AppEnv, demo, requestId } from "./middleware";
import { observeRequests } from "./observability/http";
import { adminUserRoutes } from "./routes/admin-users";
import { analyticsRoutes } from "./routes/analytics";
import { apiKeyRoutes } from "./routes/api-keys";
import { assetRoutes } from "./routes/assets";
import { assistantRoutes } from "./routes/assistant";
import { auditRoutes } from "./routes/audit";
import { batchRoutes, templateBatchRoutes } from "./routes/batches";
import { fileRoutes } from "./routes/files";
import { generationRoutes } from "./routes/generations";
import { healthRoutes } from "./routes/health";
import { notificationRoutes } from "./routes/notifications";
import { pdfSourceRoutes } from "./routes/pdf-sources";
import { privacyRoutes } from "./routes/privacy";
import { renderRoutes } from "./routes/render";
import { reviewRoutes } from "./routes/reviews";
import { savedViewRoutes } from "./routes/saved-views";
import { serviceAccountRoutes } from "./routes/service-accounts";
import { publicShareRoutes, shareLinkRoutes } from "./routes/share-links";
import { snippetRoutes } from "./routes/snippets";
import { ssoRoutes } from "./routes/sso";
import { submissionRoutes } from "./routes/submissions";
import { systemRoutes } from "./routes/system";
import { templateTestRoutes } from "./routes/template-tests";
import { templateRoutes } from "./routes/templates";
import { themeRoutes } from "./routes/themes";
import { v1Routes } from "./routes/v1";
import { webhookRoutes } from "./routes/webhooks";

const app = new Hono<AppEnv>().basePath("/api");

app.use(requestId);
// ADR 0036: request log line, metrics and server span. It logs unhandled errors, so onError only answers.
app.use(observeRequests);
app.onError((error, c) =>
  error instanceof HTTPException ? error.getResponse() : c.text("Internal Server Error", 500),
);

// ADR 0045: while `pnpm demo:reset` rebuilds the database, say so without touching it. Health
// and the instance label (which reports `resetting`) still answer.
app.use(async (c, next) => {
  if (!env.DEMO_MODE || !demoResetting() || /^\/api\/(instance|health)(\/|$)/.test(c.req.path)) {
    return next();
  }
  c.header("Retry-After", "30");
  c.header("X-Demo-Resetting", "1");
  return c.json({ error: "The demo is resetting with fresh sample data. Back in a minute." }, 503);
});

app.use(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

// ADR 0032: who and from where, for audit entries recorded anywhere below (Better Auth included).
app.use(auditScope);

// ADR 0046: the demo refuses user and session changes before Better Auth sees them.
app.on(["GET", "POST"], "/auth/*", demo.authPaths, (c) => auth.handler(c.req.raw));

// ADR 0014: bodies are capped before they're read. The slack covers a 20 MB file's multipart
// envelope; stored files are checked against the exact limit. The public demo caps every body
// lower (ADR 0046).
const MB = 1024 * 1024;
const maxBodyMb = env.DEMO_MODE ? env.DEMO_UPLOAD_MAX_MB : MAX_FILE_BYTES / MB;
app.use(
  bodyLimit({
    maxSize: env.DEMO_MODE ? env.DEMO_UPLOAD_MAX_MB * MB : MAX_FILE_BYTES + MB,
    onError: (c) => c.json({ error: `Request body is over ${maxBodyMb} MB` }, 413),
  }),
);

const routes = app
  .route("/health", healthRoutes)
  .route("/sso", ssoRoutes)
  // Public: the login page shows it too. A label for this one installation, not a tenant.
  .get("/instance", (c) => c.json(instance()))
  .get("/me", async (c) => {
    let user = c.get("user");
    // ADR 0044: in the public demo, no session means "sign in as the demo user" right here.
    if (!user && env.DEMO_MODE) {
      // ADR 0046: a few sessions an hour per address, so a script can't fill the table.
      const limited = demo.signIn(c);
      if (limited) return limited;
      const cookies = (await auth.api.demoSignIn({ returnHeaders: true })).headers.getSetCookie();
      for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
      // Read back through the new cookie: the user as every other request sees it.
      const cookie = cookies.map((set) => set.split(";")[0]).join("; ");
      user = (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user ?? null;
    }
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      user: { ...user, roles: parseRoles(user.role) },
      impersonatedBy: c.get("session")?.impersonatedBy ?? null,
      /** What this deployment has turned on; the app hides controls for what's off. */
      capabilities: { ai: aiModel !== null },
    });
  })
  .route("/render", renderRoutes)
  .route("/themes", themeRoutes)
  .route("/assets", assetRoutes)
  .route("/generations", generationRoutes)
  .route("/templates", templateRoutes)
  .route("/templates", templateBatchRoutes)
  .route("/templates", templateTestRoutes)
  .route("/templates", assistantRoutes)
  .route("/reviews", reviewRoutes)
  .route("/notifications", notificationRoutes)
  .route("/snippets", snippetRoutes)
  .route("/pdf-sources", pdfSourceRoutes)
  .route("/batches", batchRoutes)
  .route("/files", fileRoutes)
  .route("/system", systemRoutes)
  .route("/api-keys", apiKeyRoutes)
  .route("/service-accounts", serviceAccountRoutes)
  .route("/webhooks", webhookRoutes)
  .route("/admin/users", adminUserRoutes)
  .route("/audit", auditRoutes)
  .route("/saved-views", savedViewRoutes)
  .route("/privacy", privacyRoutes)
  .route("/analytics", analyticsRoutes)
  // Public, API keys only (docs/features/html-to-pdf-api.md).
  .route("/v1", v1Routes)
  .route("/submissions", submissionRoutes)
  .route("/share-links", shareLinkRoutes)
  .route("/share", publicShareRoutes);

export type AppType = typeof routes;
export default app;
