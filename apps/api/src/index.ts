import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import app from "./app";
import { auth } from "./auth";
import { seedBuiltinThemes } from "./builtin-themes";
import { db } from "./db";
import { worker } from "./db/schema";
import { ensureDemoUser } from "./demo";
import { env, runsWorker, servesApi } from "./env";
import { processId } from "./generate";
import { log } from "./log";
import { buildInfo, serveMetrics } from "./observability/metrics";
import { startTracing, stopTracing } from "./observability/tracing";
import { boss, startQueue } from "./queue";
import { closeBrowser, renderLimits } from "./render/browser";
import { healthRoutes } from "./routes/health";
import { startHeartbeat, startWorker } from "./worker";

// ADR 0020: one entry point; ROLE picks what this process does. A worker-only process still
// answers /api/health for its orchestrator.

// ADR 0036: before anything opens a span.
await startTracing({
  service: env.ROLE === "all" ? "necodoc" : `necodoc-${env.ROLE}`,
  version: env.APP_VERSION,
  instance: processId,
});
buildInfo.set({ version: env.APP_VERSION, role: env.ROLE }, 1);

// Contexts this process may hold open: a render prints the body, then its bands side by side.
renderLimits.maxConcurrent =
  2 * ((runsWorker ? env.RENDER_CONCURRENCY : 0) + (servesApi ? env.PREVIEW_CONCURRENCY : 0));

if (servesApi) await seedBuiltinThemes();
// docs/features/public-demo.md: the shared demo user exists before the first visitor.
if (servesApi && env.DEMO_MODE) await ensureDemoUser(await auth.$context);
await startQueue();
if (runsWorker) await startWorker();
await startHeartbeat();

const server = serve(
  {
    fetch: servesApi ? app.fetch : new Hono().basePath("/api").route("/health", healthRoutes).fetch,
    port: env.PORT,
  },
  (info) => {
    log.info(
      { port: info.port, processId },
      `${env.ROLE} listening on http://localhost:${info.port}`,
    );
  },
);
const metricsPort = env.METRICS_PORT;
const metricsServer = metricsPort
  ? serveMetrics(metricsPort, () =>
      log.info({ port: metricsPort }, `metrics on http://localhost:${metricsPort}/metrics`),
    )
  : undefined;

/** Lets running renders finish (up to the timeout), then leaves the cluster. */
async function shutdown(signal: string) {
  log.info({ signal }, `${signal}: stopping`);
  server.close();
  metricsServer?.close();
  const failed = (step: string) => (err: unknown) => log.error({ err }, `shutdown: ${step} failed`);
  await boss.stop({ graceful: true, timeout: 15_000 }).catch(failed("queue"));
  await db.delete(worker).where(eq(worker.id, processId)).catch(failed("heartbeat row"));
  await closeBrowser().catch(failed("browser"));
  await stopTracing().catch(failed("trace flush"));
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
