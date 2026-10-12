import { hostname } from "node:os";
import { type PausableQueue, pausableQueues } from "@necodoc/shared";
import { trace } from "@opentelemetry/api";
import { Gauge } from "@prometheus-io/client";
import { lt } from "drizzle-orm";
import type { Job, JobWithMetadata } from "pg-boss";
import { db } from "./db";
import { worker } from "./db/schema";
import { detectFields } from "./detect/detect";
import { env, runsWorker } from "./env";
import { loadSourceBytes, markLost, processId, runGeneration } from "./generate";
import { log } from "./log";
import { logContext } from "./observability/logger";
import { jobDuration, registry } from "./observability/metrics";
import {
  boss,
  type DetectJobData,
  onPauseChange,
  pausedQueues,
  queues,
  type RenderJobData,
  type WebhookJobData,
} from "./queue";
import { runRetention } from "./retention";
import { deliver } from "./webhooks";

// ADR 0020: the worker role. Consumes render jobs with RENDER_CONCURRENCY at a time, AI detection
// jobs (ADR 0028), webhook deliveries (docs/features/webhooks.md), and the scheduled jobs. Every role heartbeats so Admin > System can list the cluster.

let running = 0;

// ADR 0036: render slots, for utilization dashboards and autoscaling.
new Gauge({
  name: "necodoc_worker_renders_running",
  help: "Render jobs this process is running now.",
  registers: [registry],
  collect() {
    this.set(running);
  },
});
new Gauge({
  name: "necodoc_worker_render_slots",
  help: "Render jobs this process runs at once (RENDER_CONCURRENCY; 0 without the worker role).",
  registers: [registry],
  collect() {
    this.set(runsWorker ? env.RENDER_CONCURRENCY : 0);
  },
});

type JobLike = { id: string; data?: object; retryCount?: number };

/**
 * Wraps a queue handler: its log lines carry the queue and job id (and generation id), its time
 * goes into `necodoc_job_duration_seconds`, and failures are logged before pg-boss retries them.
 * pg-boss already runs it in a span continuing the trace that queued the job.
 */
function observed<J extends JobLike, R>(queue: string, handler: (jobs: J[]) => Promise<R>) {
  return async (jobs: J[]) => {
    const [job] = jobs;
    const generationId =
      job?.data && "generationId" in job.data && typeof job.data.generationId === "string"
        ? job.data.generationId
        : undefined;
    if (generationId) trace.getActiveSpan()?.setAttribute("necodoc.generation_id", generationId);
    const bindings = { queue, jobId: job?.id, generationId, attempt: (job?.retryCount ?? 0) + 1 };
    const started = performance.now();
    return logContext.run(bindings, async () => {
      try {
        const result = await handler(jobs);
        jobDuration.observe({ queue, status: "completed" }, (performance.now() - started) / 1000);
        log.debug({ durationMs: Math.round(performance.now() - started) }, `job ${queue} done`);
        return result;
      } catch (err) {
        jobDuration.observe({ queue, status: "failed" }, (performance.now() - started) / 1000);
        log.warn(
          { err, durationMs: Math.round(performance.now() - started) },
          `job ${queue} failed`,
        );
        throw err;
      }
    });
  };
}

/** How each pausable queue is consumed; src/queue.ts holds which ones an admin paused. */
const consumers: Record<PausableQueue, () => Promise<string>> = {
  [queues.render]: () =>
    boss.work(
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
      observed(queues.render, async ([job]: JobWithMetadata<RenderJobData>[]) => {
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
      }),
    ),
  [queues.detectFields]: () =>
    boss.work(
      queues.detectFields,
      { localConcurrency: 2 },
      observed(queues.detectFields, async ([job]: Job<DetectJobData>[]) => {
        if (!job) return;
        const bytes = await loadSourceBytes(job.data.sourceId);
        if (!bytes) throw new Error("The PDF is gone");
        return detectFields(bytes, { known: job.data.known, signal: job.signal });
      }),
    ),
  [queues.webhook]: () =>
    boss.work(
      queues.webhook,
      { localConcurrency: 4, includeMetadata: true },
      observed(queues.webhook, async ([job]: JobWithMetadata<WebhookJobData>[]) => {
        if (job) await deliver(job.data.deliveryId, job.retryCount < job.retryLimit);
      }),
    ),
  [queues.retention]: () =>
    boss.work(
      queues.retention,
      observed(queues.retention, async () => {
        log.info({ removed: await runRetention() }, "retention ran");
      }),
    ),
};

const consuming = new Set<PausableQueue>();
/** Paused queues whose running jobs may still be finishing. */
const draining = new Map<PausableQueue, Promise<void>>();
let syncing = Promise.resolve();

/**
 * Stops consuming paused queues and starts consuming the rest. Stopping lets running jobs finish
 * (pg-boss keeps their heartbeats going); it only stops fetching new ones. A resume waits for that
 * drain, so a quick pause and resume never runs more than the queue's concurrency. One at a time.
 */
function syncPaused() {
  const run = syncing.then(async () => {
    const paused = await pausedQueues();
    for (const queue of pausableQueues) {
      if (paused.includes(queue) && consuming.has(queue)) {
        consuming.delete(queue);
        draining.set(queue, boss.offWork(queue, { wait: true }));
        log.info({ queue }, "queue paused: no longer picking up jobs");
      } else if (!paused.includes(queue) && !consuming.has(queue)) {
        await draining.get(queue);
        draining.delete(queue);
        await consumers[queue]();
        consuming.add(queue);
        log.info({ queue }, "consuming queue");
      }
    }
  });
  syncing = run.catch((err) => log.error({ err }, "syncing paused queues failed"));
  return syncing;
}

export async function startWorker() {
  await syncPaused();
  await onPauseChange(() => void syncPaused());
  // The fallback, for a notification lost to a dropped connection.
  setInterval(() => void syncPaused(), HEARTBEAT_MS).unref();
  await boss.work<RenderJobData>(
    queues.renderLost,
    observed(queues.renderLost, async (jobs: Job<RenderJobData>[]) => {
      for (const job of jobs) {
        log.warn({ generationId: job.data.generationId }, "render lost: out of attempts");
        await markLost(job.data.generationId);
      }
    }),
  );
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
    () => beat().catch((err) => log.error({ err }, "heartbeat failed")),
    HEARTBEAT_MS,
  );
  timer.unref();
  return beat();
}
