import { z } from "zod";
import { generationSourceSchema } from "./generation";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (workers, metrics, health),
// docs/features/generation-log.md (retention). ADR 0020.

export const processRoleSchema = z.enum(["api", "worker", "all"]);
export type ProcessRole = z.infer<typeof processRoleSchema>;

export const metricsWindows = { "15m": 15, "1h": 60, "24h": 1440, "7d": 10080 } as const;
export const metricsWindowSchema = z.enum(["15m", "1h", "24h", "7d"]);
export type MetricsWindow = z.infer<typeof metricsWindowSchema>;

export const systemQuerySchema = z.object({ window: metricsWindowSchema.default("1h") });

const percentiles = z.object({
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
});
export type Percentiles = z.infer<typeof percentiles>;

export const workerStatusSchema = z.object({
  id: z.string(),
  host: z.string(),
  pid: z.number().int(),
  version: z.string(),
  role: processRoleSchema,
  concurrency: z.number().int(),
  running: z.number().int(),
  eventLoopLagMs: z.number(),
  startedAt: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
  online: z.boolean(),
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

const breakdownRow = z.object({
  renders: z.number().int(),
  errors: z.number().int(),
  p50TotalMs: z.number().nullable(),
  p95TotalMs: z.number().nullable(),
});

/** GET /api/system */
export const systemStatusSchema = z.object({
  window: metricsWindowSchema,
  /** Every process seen in the last day; `online` ones reported within the last few seconds. */
  workers: z.array(workerStatusSchema),
  /** Jobs not finished yet, by priority. */
  queue: z.object({
    interactive: z.object({ queued: z.number().int(), running: z.number().int() }),
    batch: z.object({ queued: z.number().int(), running: z.number().int() }),
  }),
  metrics: z.object({
    renders: z.number().int(),
    errors: z.number().int(),
    rendersPerMinute: z.number(),
    errorRate: z.number().nullable(),
    totalMs: percentiles,
    queueWaitMs: percentiles,
  }),
  bySource: z.array(breakdownRow.extend({ source: generationSourceSchema })),
  byTemplate: z.array(
    breakdownRow.extend({ templateId: z.uuid(), templateName: z.string().nullable() }),
  ),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

const days = z.number().int().min(1).max(3650).nullable();

/** Null keeps forever. Metadata is always kept. */
export const retentionSettingsSchema = z.object({ outputDays: days, inputDays: days });
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

// Live queue (Admin): pg-boss jobs as they stand, joined to their generations.

export const jobStateSchema = z.enum([
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
]);
export type JobState = z.infer<typeof jobStateSchema>;

export const queueJobsQuerySchema = z.object({
  /** Default: everything not finished, plus failures from the last 24 hours. */
  state: jobStateSchema.optional(),
  /** pg-boss queue name: render, render-lost, retention. */
  queue: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const queueJobSchema = z.object({
  id: z.uuid(),
  queue: z.string(),
  priority: z.number().int(),
  state: jobStateSchema,
  generationId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  generationStatus: z.string().nullable(),
  filename: z.string().nullable(),
  createdOn: z.iso.datetime(),
  startedOn: z.iso.datetime().nullable(),
  completedOn: z.iso.datetime().nullable(),
  retryCount: z.number().int(),
  retryLimit: z.number().int(),
  /** From the generation: the process running (or that last ran) it. */
  workerId: z.string().nullable(),
});
export type QueueJob = z.infer<typeof queueJobSchema>;
