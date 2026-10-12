import { z } from "zod";

// Spec: docs/features/performance-benchmark.md. The shape of results/latest.json, which the
// marketing site imports. Change it and bump SCHEMA_VERSION, so an old import fails loudly.

export const SCHEMA_VERSION = 1;

/** Milliseconds over a set of samples. Null percentiles only when there are no samples. */
export const statsSchema = z.object({
  n: z.int().min(0),
  mean: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  p99: z.number().nullable(),
});
export type Stats = z.infer<typeof statsSchema>;

/** Mean milliseconds per render step, from the generation log's timing breakdown. */
export const breakdownSchema = z.object({
  liquidMs: z.number(),
  chromiumMs: z.number(),
  bandsMs: z.number(),
  stampMs: z.number(),
  finishMs: z.number(),
});

/** One sequential latency scenario: client round trip plus the generation log's view of it. */
export const latencySchema = z.object({
  id: z.string(),
  label: z.string(),
  pages: z.int(),
  warmup: z.int().min(0),
  /** Client-measured: request sent to last PDF byte received. */
  roundTrip: statsSchema,
  /** Server-side, from the generation log. */
  queueWait: statsSchema,
  run: statsSchema,
  total: statsSchema,
  breakdown: breakdownSchema,
});
export type Latency = z.infer<typeof latencySchema>;

export const throughputSchema = z.object({
  workers: z.int().min(1),
  concurrency: z.int().min(1),
  rows: z.int().min(1),
  failed: z.int().min(0),
  /** Batch created to its last row finished, server clock. */
  wallMs: z.number(),
  docsPerMinute: z.number(),
  /** Per row, from the generation log. */
  queueWait: statsSchema,
  run: statsSchema,
});
export type Throughput = z.infer<typeof throughputSchema>;

export const coldWarmSchema = z.object({
  /** First render on a freshly started worker: includes launching Chromium. */
  cold: statsSchema,
  /** The same render once that worker is warm. */
  warm: statsSchema,
  /** Worker process spawn to ready (health), before any render. */
  workerStart: statsSchema,
});

export const environmentSchema = z.object({
  cpu: z.string(),
  cores: z.int(),
  memoryGb: z.number(),
  os: z.string(),
  node: z.string(),
  chromium: z.string(),
  postgres: z.string(),
  gitSha: z.string(),
  gitDirty: z.boolean(),
  /** 1, 5 and 15 minute load averages just before the run. */
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  storage: z.string(),
});

export const resultsSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  /** `--quick` smoke runs aren't for publishing. */
  quick: z.boolean(),
  environment: environmentSchema,
  settings: z.object({
    samples: z.int(),
    warmup: z.int(),
    batchRows: z.int(),
    workerCounts: z.array(z.int()),
    /** RENDER_CONCURRENCY on every worker. */
    concurrency: z.int(),
    coldStarts: z.int(),
    /** Latency scenarios run against this many workers. */
    latencyWorkers: z.int(),
  }),
  latency: z.array(latencySchema),
  throughput: z.array(throughputSchema),
  coldWarm: coldWarmSchema,
  /** PDF/A-2b + PDF/UA on the invoice against the plain invoice; null when skipped. */
  archival: z
    .object({ plain: latencySchema, archival: latencySchema, overheadP50Ms: z.number() })
    .nullable(),
});
export type Results = z.infer<typeof resultsSchema>;
