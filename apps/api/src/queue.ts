import { PgBoss } from "pg-boss";
import { db } from "./db";
import { env, runsWorker } from "./env";

// ADR 0020: pg-boss on the app's Postgres (its own `pgboss` schema). Job payloads carry ids only;
// the input lives on the generation row.

export const queues = {
  /** One logged render. */
  render: "render",
  /** Render jobs that ran out of attempts (dead letters), so the generation gets marked failed. */
  renderLost: "render-lost",
  /** Scheduled log retention (docs/features/generation-log.md). */
  retention: "retention",
} as const;

export type RenderJobData = { generationId: string };

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
});

boss.on("error", (error) => console.error("pg-boss:", error));

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
