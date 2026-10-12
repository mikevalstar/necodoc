import {
  type PausableQueue,
  pausableQueues,
  type QueueSettings,
  queueSettingsSchema,
  withPaused,
} from "@necodoc/shared";
import { Gauge } from "@prometheus-io/client";
import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { db } from "./db";
import { setting } from "./db/schema";
import { env, runsWorker } from "./env";
import { log } from "./log";
import { registry } from "./observability/metrics";
import { tracingEnabled } from "./observability/tracing";

// ADR 0020: pg-boss on the app's Postgres (its own `pgboss` schema). Job payloads carry ids only;
// the input lives on the generation row.

export const queues = {
  /** One logged render. */
  render: "render",
  /** Render jobs that ran out of attempts (dead letters), so the generation gets marked failed. */
  renderLost: "render-lost",
  /** Scheduled log retention (docs/features/generation-log.md). */
  retention: "retention",
  /** AI field detection on an uploaded PDF (ADR 0028). The suggestions are the job's output. */
  detectFields: "detect-fields",
  /** One webhook delivery (docs/features/webhooks.md); a failed POST throws and is retried. */
  webhook: "webhook",
} as const;

export type RenderJobData = { generationId: string };
export type WebhookJobData = { deliveryId: string };
/** Who asked, so only they can read the result; the template's fields, to reuse their keys. */
export type DetectJobData = {
  sourceId: string;
  userId: string;
  known: { key: string; label: string }[];
};

/** pg-boss fetches higher numbers first: people waiting on a PDF go ahead of batch rows. */
export const priorities = { interactive: 10, batch: 0 } as const;

export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  application_name: `necodoc-${env.ROLE}`,
  instanceName: env.ROLE,
  // Wakes workers the moment a job is created instead of on their next poll.
  useListenNotify: true,
  // Lost jobs (missed heartbeats) are found on the supervise pass; keep it short.
  superviseIntervalSeconds: 10,
  monitorIntervalSeconds: 10,
  // Cron runs once per cluster, on whichever process with a worker role gets there first.
  schedule: runsWorker,
  // ADR 0036: jobs carry the trace context of whoever queued them; the worker's span continues it.
  openTelemetry: { enabled: tracingEnabled, propagateContext: true },
});

boss.on("error", (err) => log.error({ err }, "pg-boss error"));
boss.on("warning", (warning) => log.warn({ warning }, "pg-boss warning"));

// ADR 0036: pg-boss's cached queue counts (refreshed every monitor pass), the same on every
// process. Read once per scrape for both gauges (the registry collects them in parallel).
let snapshot: { at: number; queues: ReturnType<typeof boss.getQueues> } | undefined;
function queueSnapshot() {
  if (!snapshot || Date.now() - snapshot.at > 1000) {
    snapshot = { at: Date.now(), queues: boss.getQueues(Object.values(queues)) };
  }
  return snapshot.queues;
}
new Gauge({
  name: "necodoc_queue_jobs",
  help: "Jobs per pg-boss queue and state, cluster-wide (aggregate with max, not sum).",
  labelNames: ["queue", "state"] as const,
  registers: [registry],
  async collect() {
    if (!queueStatus.started) return;
    for (const queue of await queueSnapshot()) {
      for (const state of ["ready", "deferred", "active", "failed"] as const) {
        this.set({ queue: queue.name, state }, queue[`${state}Count`]);
      }
    }
  },
});
new Gauge({
  name: "necodoc_queue_oldest_ready_seconds",
  help: "How long the oldest ready job of each queue had waited, at pg-boss's last monitor pass.",
  labelNames: ["queue"] as const,
  registers: [registry],
  async collect() {
    if (!queueStatus.started) return;
    for (const queue of await queueSnapshot()) {
      this.set({ queue: queue.name }, queue.readyOldestSeconds ?? 0);
    }
  },
});

new Gauge({
  name: "necodoc_queue_paused",
  help: "1 while an admin has the queue paused (no worker picks up its jobs), else 0.",
  labelNames: ["queue"] as const,
  registers: [registry],
  async collect() {
    const paused = await pausedQueues();
    for (const queue of pausableQueues) this.set({ queue }, paused.includes(queue) ? 1 : 0);
  },
});

// Paused queues (docs/features/render-queue-batch-jobs-and-scaling.md): one setting row every
// process reads, so a pause reaches every worker and survives restarts. pg-boss 12 has no pause of
// its own; workers stop and restart their own consumers (src/worker.ts).

const PAUSE_CHANNEL = "queue_paused";

export async function pausedQueues(): Promise<PausableQueue[]> {
  const [row] = await db.select().from(setting).where(eq(setting.key, "queues"));
  return row ? queueSettingsSchema.parse(row.value).paused : [];
}

/** Saves the queue's paused state and tells every worker to act on it now. Returns the before and after. */
export async function setQueuePaused(queue: PausableQueue, paused: boolean, userId: string) {
  return db.transaction(async (tx) => {
    // Locks the row, so two admins pausing different queues at once don't drop each other's.
    const [row] = await tx.select().from(setting).where(eq(setting.key, "queues")).for("update");
    const before = row ? queueSettingsSchema.parse(row.value).paused : [];
    const value: QueueSettings = { paused: withPaused(before, queue, paused) };
    await tx
      .insert(setting)
      .values({ key: "queues", value, updatedBy: userId })
      .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: userId } });
    await tx.execute(sql`select pg_notify(${PAUSE_CHANNEL}, '')`);
    return { before, after: value.paused };
  });
}

/** Calls `onChange` whenever an admin pauses or resumes a queue (on any API node). */
export const onPauseChange = (onChange: () => void) => db.$client.listen(PAUSE_CHANNEL, onChange);

/** For readiness checks. */
export const queueStatus = { started: false };

/** Starts pg-boss and makes sure the queues exist (creating one is a no-op once it does). */
export async function startQueue() {
  await boss.start();
  await boss.createQueue(queues.renderLost, { notify: true });
  await boss.createQueue(queues.render, {
    notify: true,
    // Infrastructure failures retry (src/generate.ts decides which errors count).
    retryLimit: 2,
    retryDelay: 1,
    // A worker that dies stops heartbeating; the supervisor fails the job and it retries.
    heartbeatSeconds: 10,
    // Three Chromium passes at the 30 s render timeout, plus slack.
    expireInSeconds: 180,
    deadLetter: queues.renderLost,
  });
  await boss.createQueue(queues.retention, { policy: "singleton" });
  await boss.createQueue(queues.detectFields, {
    notify: true,
    // A model call that failed is the user's to retry, not ours: each one costs money.
    retryLimit: 0,
    // 20 pages at 5 to 10 s each, plus slack. The output is read within minutes, then dropped.
    expireInSeconds: 300,
    deleteAfterSeconds: 24 * 60 * 60,
  });
  await boss.createQueue(queues.webhook, {
    notify: true,
    // 5 retries, each wait doubling from 20 to 40 s (pg-boss jitters within each step): about
    // 10 to 20 minutes from the first attempt to the last.
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    // A 10 s request timeout, plus slack.
    expireInSeconds: 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
  queueStatus.started = true;
}

// Finished generations are announced on a Postgres channel, so the API node holding a
// synchronous request wakes at once instead of polling the row.

const CHANNEL = "generation_finished";
const waiters = new Map<string, Set<() => void>>();
let listening: Promise<unknown> | null = null;

export async function announceFinished(generationId: string) {
  await db.$client.notify(CHANNEL, generationId);
}

/**
 * Resolves true once `isDone()` holds, re-checking on each announcement for this id (and every
 * second, in case one was missed), or false after `timeoutMs`.
 */
export async function waitUntilFinished(
  generationId: string,
  timeoutMs: number,
  isDone: () => Promise<boolean>,
) {
  listening ??= db.$client.listen(CHANNEL, (id) => {
    for (const wake of waiters.get(id) ?? []) wake();
  });
  await listening;
  let notified = false;
  let wake = () => {};
  const onAnnounce = () => {
    notified = true;
    wake();
  };
  const set = waiters.get(generationId) ?? new Set();
  waiters.set(generationId, set.add(onAnnounce));
  try {
    const deadline = Date.now() + timeoutMs;
    while (!(await isDone())) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      if (!notified) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, Math.min(left, 1000));
        });
      }
      notified = false;
    }
    return true;
  } finally {
    set.delete(onAnnounce);
    if (!set.size) waiters.delete(generationId);
  }
}
