import { hostname } from "node:os";
import { lt } from "drizzle-orm";
import type { Job, JobWithMetadata } from "pg-boss";
import { db } from "./db";
import { worker } from "./db/schema";
import { detectFields } from "./detect/detect";
import { env, runsWorker } from "./env";
import { loadSourceBytes, markLost, processId, runGeneration } from "./generate";
import { boss, type DetectJobData, queues, type RenderJobData, type WebhookJobData } from "./queue";
import { runRetention } from "./retention";
import { deliver } from "./webhooks";

// ADR 0020: the worker role. Consumes render jobs with RENDER_CONCURRENCY at a time, AI detection
// jobs (ADR 0028), webhook deliveries (docs/features/webhooks.md), and the scheduled jobs. Every role heartbeats so Admin > System can list the cluster.

let running = 0;

export async function startWorker() {
  await boss.work(
    queues.render,
    {
      localConcurrency: env.RENDER_CONCURRENCY,
      includeMetadata: true,
      // The lowest pg-boss allows, with or without NOTIFY. NOTIFY wakes idle workers for a new
      // job, but after finishing one a worker waits out this interval before fetching again, so
      // a longer one throttles batches. Costs two cheap polls a second per idle slot.
      pollingIntervalSeconds: 0.5,
      notifyPollingIntervalSeconds: 0.5,
    },
    async ([job]: JobWithMetadata<RenderJobData>[]) => {
      if (!job) return;
      running++;
      try {
        await runGeneration(
          job.data.generationId,
          job.retryCount + 1,
          job.retryCount < job.retryLimit,
        );
      } finally {
        running--;
      }
    },
  );
  await boss.work<RenderJobData>(queues.renderLost, async (jobs) => {
    for (const job of jobs) await markLost(job.data.generationId);
  });
  await boss.work(
    queues.detectFields,
    { localConcurrency: 2 },
    async ([job]: Job<DetectJobData>[]) => {
      if (!job) return;
      const bytes = await loadSourceBytes(job.data.sourceId);
      if (!bytes) throw new Error("The PDF is gone");
      return detectFields(bytes, { known: job.data.known, signal: job.signal });
    },
  );
  await boss.work(
    queues.webhook,
    { localConcurrency: 4, includeMetadata: true },
    async ([job]: JobWithMetadata<WebhookJobData>[]) => {
      if (job) await deliver(job.data.deliveryId, job.retryCount < job.retryLimit);
    },
  );
  await boss.work(queues.retention, async () => {
    console.log("retention:", await runRetention());
  });
  await boss.schedule(queues.retention, "17 3 * * *");
}

/** Worst event-loop delay since the last heartbeat, from a timer's drift. */
function lagMonitor(intervalMs = 250) {
  let worst = 0;
  let expected = performance.now() + intervalMs;
  setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - expected);
    expected = now + intervalMs;
  }, intervalMs).unref();
  return () => {
    const lag = worst;
    worst = 0;
    return Math.round(lag);
  };
}

const HEARTBEAT_MS = 5000;

/** A process that missed three heartbeats is offline. */
export const onlineSince = () => new Date(Date.now() - 3 * HEARTBEAT_MS);

/** Upserts this process's row every few seconds; drops rows nobody has refreshed for a day. */
export function startHeartbeat() {
  const takeLag = lagMonitor();
  const startedAt = new Date();
  const beat = async () => {
    const row = {
      id: processId,
      host: hostname(),
      pid: process.pid,
      version: env.APP_VERSION,
      role: env.ROLE,
      concurrency: runsWorker ? env.RENDER_CONCURRENCY : 0,
      running,
      eventLoopLagMs: takeLag(),
      startedAt,
      lastSeen: new Date(),
    };
    await db.insert(worker).values(row).onConflictDoUpdate({ target: worker.id, set: row });
    await db.delete(worker).where(lt(worker.lastSeen, new Date(Date.now() - 86_400_000)));
  };
  const timer = setInterval(
    () => beat().catch((error) => console.error("heartbeat:", error)),
    HEARTBEAT_MS,
  );
  timer.unref();
  return beat();
}
