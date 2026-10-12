import type { PgBoss } from "pg-boss";

/**
 * Starts `slots` one-job pg-boss workers on a queue (through `start`, which calls `boss.work` with the wrapped `handler`).
 * Each one fetches its next job the moment it finishes one: pg-boss would otherwise wait out the
 * polling interval after every job, capping a slot at two jobs a second however fast they run.
 * Only a fetch that comes back empty waits, until NOTIFY or the next poll.
 *
 * One `work()` call per slot so each handler knows its own worker id. Everything else stays
 * pg-boss's: fetch order (priority), retries, heartbeats, trace context, `offWork` (it stops every
 * worker on the queue) and shutdown.
 */
export async function workInSlots<J>(
  boss: Pick<PgBoss, "notifyWorker">,
  slots: number,
  handler: (jobs: J[]) => Promise<void>,
  start: (handler: (jobs: J[]) => Promise<void>) => Promise<string>,
) {
  for (let slot = 0; slot < slots; slot++) {
    let workerId: string | undefined;
    workerId = await start(async (jobs) => {
      try {
        await handler(jobs);
      } finally {
        // Skips this slot's next poll wait. Set before its first fetch returns: work() starts the
        // loop but the fetch is a database round trip away.
        if (workerId) boss.notifyWorker(workerId);
      }
    });
  }
}
