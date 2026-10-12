import { and, count, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { worker } from "../db/schema";
import { env } from "../env";
import { queueStatus } from "../queue";
import { storage, storageReachable } from "../storage";
import { onlineSince } from "../worker";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (health). Unauthenticated, for load
// balancers and orchestrators; served by every role.

export const healthRoutes = new Hono()
  /** Liveness: the process answers. */
  .get("/", (c) => c.json({ ok: true, role: env.ROLE }))
  /**
   * Readiness: the database answers, the queue is up (enqueueing for api, consuming for worker),
   * and output storage round-trips (ADR 0023).
   */
  .get("/ready", async (c) => {
    const [database, stored] = await Promise.all([
      db.execute(sql`select 1`).then(
        () => true,
        () => false,
      ),
      storageReachable(),
    ]);
    const [workers] = database
      ? await db
          .select({ count: count() })
          .from(worker)
          .where(and(inArray(worker.role, ["worker", "all"]), gte(worker.lastSeen, onlineSince())))
      : [];
    const ready = database && queueStatus.started && stored.ok;
    return c.json(
      {
        ready,
        role: env.ROLE,
        database,
        queue: queueStatus.started,
        storage: { driver: storage.name, ...stored },
        // Informational: an API node can still accept async work with no workers, but nothing renders.
        workersOnline: workers?.count ?? 0,
      },
      ready ? 200 : 503,
    );
  });
