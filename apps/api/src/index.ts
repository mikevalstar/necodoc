import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import app from "./app";
import { seedBuiltinThemes } from "./builtin-themes";
import { db } from "./db";
import { worker } from "./db/schema";
import { env, runsWorker, servesApi } from "./env";
import { processId } from "./generate";
import { boss, startQueue } from "./queue";
import { closeBrowser, renderLimits } from "./render/browser";
import { healthRoutes } from "./routes/health";
import { startHeartbeat, startWorker } from "./worker";

// ADR 0020: one entry point; ROLE picks what this process does. A worker-only process still
// answers /api/health for its orchestrator.

// Contexts this process may hold open: a render prints the body, then its bands side by side.
renderLimits.maxConcurrent =
  2 * ((runsWorker ? env.RENDER_CONCURRENCY : 0) + (servesApi ? env.PREVIEW_CONCURRENCY : 0));

if (servesApi) await seedBuiltinThemes();
await startQueue();
if (runsWorker) await startWorker();
await startHeartbeat();

const server = serve(
  {
    fetch: servesApi ? app.fetch : new Hono().basePath("/api").route("/health", healthRoutes).fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`${env.ROLE} (${processId}) listening on http://localhost:${info.port}`);
  },
);

/** Lets running renders finish (up to the timeout), then leaves the cluster. */
async function shutdown(signal: string) {
  console.log(`${signal}: stopping`);
  server.close();
  await boss.stop({ graceful: true, timeout: 15_000 }).catch(console.error);
  await db.delete(worker).where(eq(worker.id, processId)).catch(console.error);
  await closeBrowser().catch(console.error);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
