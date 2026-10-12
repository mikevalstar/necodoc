import { zValidator } from "@hono/zod-validator";
import {
  type GenerationSource,
  type JobState,
  metricsWindows,
  type Percentiles,
  publishingSettingsSchema,
  queueJobsQuerySchema,
  queuePauseSchema,
  retentionSettingsSchema,
  retryFailedSchema,
  systemQuerySchema,
} from "@necodoc/shared";
import { and, desc, eq, gte, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { generation, template, worker } from "../db/schema";
import { env } from "../env";
import { RETRY_LIMIT, retryFailedRenders } from "../generate";
import { type AppEnv, requireRole } from "../middleware";
import { announceFinished, boss, pausedQueues, setQueuePaused } from "../queue";
import { retentionSettings, runRetention, saveRetentionSettings } from "../retention";
import { publishingSettings, savePublishingSettings } from "../review";
import { storage } from "../storage";
import { systemConfig } from "../system-config";
import { onlineSince } from "../worker";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (Admin > System). Metrics come from
// the generation log itself, so they cover every worker without a metrics store.

const percentiles = (column: typeof generation.totalMs | typeof generation.queueWaitMs) =>
  sql<
    (number | null)[] | null
  >`percentile_cont(array[0.5, 0.95, 0.99]) within group (order by ${column})`;

const toPercentiles = (values: (number | null)[] | null): Percentiles => ({
  p50: values?.[0] ?? null,
  p95: values?.[1] ?? null,
  p99: values?.[2] ?? null,
});

const renders = sql<number>`count(*)`.mapWith(Number);
const errors = sql<number>`count(*) filter (where ${generation.status} = 'error')`.mapWith(Number);
const p50Total = sql<
  number | null
>`percentile_cont(0.5) within group (order by ${generation.totalMs})`;
const p95Total = sql<
  number | null
>`percentile_cont(0.95) within group (order by ${generation.totalMs})`;

export const systemRoutes = new Hono<AppEnv>()
  .use(requireRole("admin"))
  .get("/", zValidator("query", systemQuerySchema), async (c) => {
    const { window } = c.req.valid("query");
    const since = new Date(Date.now() - metricsWindows[window] * 60_000);
    const finishedInWindow = and(
      gte(generation.finishedAt, since),
      inArray(generation.status, ["success", "error"]),
    );
    const [workers, depth, [overall], bySource, byTemplate] = await Promise.all([
      db.select().from(worker).orderBy(desc(worker.lastSeen)),
      db
        .select({
          batch: isNotNull(generation.batchId).mapWith(Boolean),
          status: generation.status,
          count: renders,
        })
        .from(generation)
        .where(inArray(generation.status, ["queued", "running"]))
        .groupBy(isNotNull(generation.batchId), generation.status),
      db
        .select({
          renders,
          errors,
          totalMs: percentiles(generation.totalMs),
          queueWaitMs: percentiles(generation.queueWaitMs),
        })
        .from(generation)
        .where(finishedInWindow),
      db
        .select({
          source: generation.source,
          renders,
          errors,
          p50TotalMs: p50Total,
          p95TotalMs: p95Total,
        })
        .from(generation)
        .where(finishedInWindow)
        .groupBy(generation.source)
        .orderBy(desc(renders)),
      db
        .select({
          templateId: sql<string>`${generation.templateId}`,
          templateName: template.name,
          renders,
          errors,
          p50TotalMs: p50Total,
          p95TotalMs: p95Total,
        })
        .from(generation)
        .leftJoin(template, eq(template.id, generation.templateId))
        .where(and(finishedInWindow, isNotNull(generation.templateId)))
        .groupBy(generation.templateId, template.name)
        .orderBy(desc(renders))
        .limit(20),
    ]);
    const online = onlineSince();
    const queue = { interactive: { queued: 0, running: 0 }, batch: { queued: 0, running: 0 } };
    for (const row of depth) {
      if (row.status === "queued" || row.status === "running") {
        queue[row.batch ? "batch" : "interactive"][row.status] = row.count;
      }
    }
    const total = overall?.renders ?? 0;
    return c.json({
      window,
      workers: workers.map((w) => ({ ...w, online: w.lastSeen >= online })),
      queue,
      metrics: {
        renders: total,
        errors: overall?.errors ?? 0,
        rendersPerMinute: total / metricsWindows[window],
        errorRate: total ? (overall?.errors ?? 0) / total : null,
        totalMs: toPercentiles(overall?.totalMs ?? null),
        queueWaitMs: toPercentiles(overall?.queueWaitMs ?? null),
      },
      bySource: bySource.map((row) => ({ ...row, source: row.source as GenerationSource })),
      byTemplate,
      /** This API node's APP_VERSION (workers report theirs in heartbeats). */
      version: env.APP_VERSION,
      pausedQueues: await pausedQueues(),
      /** ADR 0023: where this API node writes and reads generated outputs. */
      storage: { driver: storage.name, target: storage.target, redirect: env.STORAGE_REDIRECT },
    });
  })
  // Configuration status (no secrets), apart from the 5-second poll: it starts Chromium and
  // round-trips storage.
  .get("/config", async (c) => c.json(await systemConfig()))
  .get("/retention", async (c) => c.json(await retentionSettings()))
  .put("/retention", zValidator("json", retentionSettingsSchema), async (c) => {
    const before = await retentionSettings();
    await saveRetentionSettings(c.req.valid("json"), c.get("user").id);
    const after = await retentionSettings();
    await recordAudit({
      action: "settings.retention_updated",
      target: { id: "retention", name: "Retention" },
      before,
      after,
    });
    return c.json(after);
  })
  .post("/retention/run", async (c) => c.json(await runRetention()))
  // docs/features/review-and-approval.md
  .get("/publishing", async (c) => c.json(await publishingSettings()))
  .put("/publishing", zValidator("json", publishingSettingsSchema), async (c) => {
    const before = await publishingSettings();
    await savePublishingSettings(c.req.valid("json"), c.get("user").id);
    const after = await publishingSettings();
    await recordAudit({
      action: "settings.publishing_updated",
      target: { id: "publishing", name: "Publishing" },
      before,
      after,
    });
    return c.json(after);
  })
  .get("/queue", zValidator("query", queueJobsQuerySchema), async (c) => {
    const { state, queue, limit, offset } = c.req.valid("query");
    const where = sql.join(
      [
        state
          ? sql`j.state = ${state}::pgboss.job_state`
          : sql`(j.state in ('created', 'retry', 'active') or (j.state = 'failed' and j.completed_on > now() - interval '24 hours'))`,
        queue ? sql`j.name = ${queue}` : sql`true`,
      ],
      sql` and `,
    );
    // pg-boss has no listing API, so this reads its job table (schema `pgboss`) directly.
    const [items, [total], counts, [oldest]] = await Promise.all([
      db.execute<QueueJobRow>(sql`
        select j.id, j.name as queue, j.priority, j.state::text as state,
          g.id as generation_id, g.batch_id, g.status as generation_status, g.filename,
          ${iso(sql`j.created_on`)} as created_on, ${iso(sql`j.started_on`)} as started_on,
          ${iso(sql`j.completed_on`)} as completed_on, j.retry_count, j.retry_limit, g.worker_id
        from pgboss.job j
        left join ${generation} g on g.id = (j.data->>'generationId')::uuid
        where ${where}
        order by j.state = 'active' desc, j.priority desc, j.created_on asc
        limit ${limit} offset ${offset}`),
      db.execute<{ count: number }>(
        sql`select count(*)::int as count from pgboss.job j where ${where}`,
      ),
      db.execute<{ queue: string; state: JobState; count: number }>(
        sql`select name as queue, state::text as state, count(*)::int as count from pgboss.job group by 1, 2 order by 1, 2`,
      ),
      // The longest wait, whatever page or state view is shown (the queue filter still applies).
      db.execute<{ at: string | null }>(
        sql`select ${iso(sql`min(j.created_on)`)} as at from pgboss.job j
          where j.state in ('created', 'retry') and ${queue ? sql`j.name = ${queue}` : sql`true`}`,
      ),
    ]);
    return c.json({
      items: items.map((row) => ({
        id: row.id,
        queue: row.queue,
        priority: row.priority,
        state: row.state,
        generationId: row.generation_id,
        batchId: row.batch_id,
        generationStatus: row.generation_status,
        filename: row.filename,
        createdOn: row.created_on,
        startedOn: row.started_on,
        completedOn: row.completed_on,
        retryCount: row.retry_count,
        retryLimit: row.retry_limit,
        workerId: row.worker_id,
      })),
      total: total?.count ?? 0,
      /** When the oldest waiting (created or retry) job was queued; null when nothing waits. */
      oldestWaitingAt: oldest?.at ?? null,
      /** Every job pg-boss still keeps (completed ones for 7 days), by queue and state. */
      counts: [...counts],
    });
  })
  .post("/queue/:jobId/cancel", zValidator("param", z.object({ jobId: z.uuid() })), async (c) => {
    const { jobId } = c.req.valid("param");
    const [job] = await db.execute<{ name: string; generation_id: string | null }>(
      sql`select name, data->>'generationId' as generation_id from pgboss.job where id = ${jobId}`,
    );
    if (!job) return c.json({ error: "Job not found" }, 404);
    await boss.cancel(job.name, jobId);
    // A running render keeps going, but its result is dropped: the worker only records an
    // outcome on a row that is still queued or running.
    const [cancelled] = job.generation_id
      ? await db
          .update(generation)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(
            and(
              eq(generation.id, job.generation_id),
              inArray(generation.status, ["queued", "running"]),
            ),
          )
          .returning({ id: generation.id })
      : [];
    if (cancelled) await announceFinished(cancelled.id);
    return c.json({ jobId, generationId: job.generation_id, generationCancelled: !!cancelled });
  })
  // Pausing stops every worker fetching the queue's jobs (src/worker.ts); running ones finish.
  .post("/queue/pause", zValidator("json", queuePauseSchema), async (c) => {
    const { queue, paused } = c.req.valid("json");
    const { before, after } = await setQueuePaused(queue, paused, c.get("user").id);
    if (before.includes(queue) !== paused) {
      await recordAudit({
        action: paused ? "settings.queue_paused" : "settings.queue_resumed",
        target: { id: `queue:${queue}`, name: `Queue ${queue}` },
        before: { paused: before },
        after: { paused: after },
      });
    }
    return c.json({ pausedQueues: after });
  })
  // Retry in place: same job, same generation entry (unlike Re-run, which logs a new one).
  .post("/queue/:jobId/retry", zValidator("param", z.object({ jobId: z.uuid() })), async (c) => {
    const { jobId } = c.req.valid("param");
    const [generationId] = await retryFailedRenders(sql`j.id = ${jobId}`);
    if (!generationId) {
      return c.json(
        { error: "Only a failed render job whose generation failed can be retried" },
        409,
      );
    }
    await recordAudit({ action: "generation.retried", target: { id: generationId } });
    return c.json({ jobId, generationId });
  })
  .post("/queue/retry-failed", zValidator("json", retryFailedSchema), async (c) => {
    const { queue } = c.req.valid("json");
    const retried = (await retryFailedRenders(queue ? sql`j.name = ${queue}` : sql`true`)).length;
    if (retried) {
      await recordAudit({
        action: "generation.bulk_retried",
        target: { id: null, name: `${retried} generations` },
        details: { queue: queue ?? null, retried },
      });
    }
    return c.json({ retried, limit: RETRY_LIMIT });
  });

/** Raw queries skip drizzle's column mapping; format timestamps as the ISO strings JSON wants. */
const iso = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type QueueJobRow = {
  id: string;
  queue: string;
  priority: number;
  state: JobState;
  generation_id: string | null;
  batch_id: string | null;
  generation_status: string | null;
  filename: string | null;
  created_on: string;
  started_on: string | null;
  completed_on: string | null;
  retry_count: number;
  retry_limit: number;
  worker_id: string | null;
};
