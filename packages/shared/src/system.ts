import { z } from "zod";
import { generationSourceSchema } from "./generation";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (workers, metrics, health),
// docs/features/generation-log.md (retention). ADR 0020.

export const processRoleSchema = z.enum(["api", "worker", "all"]);
export type ProcessRole = z.infer<typeof processRoleSchema>;

/** docs/features/app-shell-and-navigation.md (instance identity): the sidebar and login label. */
export const instanceEnvSchema = z.enum(["prod", "staging", "dev", "demo"]);
export type InstanceEnv = z.infer<typeof instanceEnvSchema>;
/** GET /api/instance (public). Null name: not configured, nothing shown. */
export const instanceSchema = z.object({
  name: z.string().nullable(),
  env: instanceEnvSchema.nullable(),
  /** docs/features/public-demo.md: signed in automatically, no sign-in or sign out. */
  demoMode: z.boolean(),
  /** A demo reset is running (docs/features/public-demo.md, Nightly reset). */
  resetting: z.boolean(),
  /** The next scheduled demo reset, or null without one; shown in `resetTimeZone`. */
  nextResetAt: z.iso.datetime().nullable(),
  resetTimeZone: z.string().nullable(),
});
export type Instance = z.infer<typeof instanceSchema>;

/** Why a control is off in the public demo: the API's 403 and the app's tooltip (ADR 0046). */
export const DEMO_DISABLED = "Turned off in the public demo.";

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
  /** This API node's APP_VERSION. */
  version: z.string(),
  /** Queues an admin paused: workers pick up none of their jobs until resumed. */
  pausedQueues: z.array(z.string()),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

/** A certifying certificate warns this many days before it expires. */
export const CERT_WARN_DAYS = 30;

/**
 * GET /api/system/config: what the answering API process is configured with. Never secrets:
 * URLs are reduced to their host, keys and passwords to whether they're set.
 */
export const systemConfigSchema = z.object({
  instance: instanceSchema,
  role: processRoleSchema,
  /** Null when Chromium can't start; `error` says why. */
  chromium: z.object({ version: z.string().nullable(), error: z.string().nullable() }),
  ai: z.object({ enabled: z.boolean(), model: z.string() }),
  auth: z.object({
    password: z.boolean(),
    trustedHeader: z.boolean(),
    sso: z.array(
      z.object({ id: z.string(), label: z.string(), type: z.enum(["oidc", "saml", "header"]) }),
    ),
  }),
  /** Null when no CERTIFY_* certificate is set. */
  certification: z
    .object({
      subject: z.string().nullable(),
      issuer: z.string().nullable(),
      notAfter: z.iso.datetime().nullable(),
      /** Set when the certificate is configured but can't be loaded (or isn't valid now). */
      error: z.string().nullable(),
      tsaHost: z.string().nullable(),
    })
    .nullable(),
  storage: z.object({
    driver: z.string(),
    target: z.string(),
    redirect: z.enum(["off", "presigned"]),
    ok: z.boolean(),
    error: z.string().nullable(),
  }),
  metricsPort: z.number().int().nullable(),
  tracing: z.object({ enabled: z.boolean(), endpointHost: z.string().nullable() }),
  logging: z.object({ level: z.string(), format: z.enum(["json", "pretty"]) }),
  retention: z.object({
    outputDays: z.number().int().nullable(),
    inputDays: z.number().int().nullable(),
  }),
});
export type SystemConfig = z.infer<typeof systemConfigSchema>;

/** How a configuration item reads on Admin > System: working, needs attention, broken, or not set. */
export type ConfigState = "ok" | "warn" | "bad" | "off";

/** The certifying certificate: off when unset, bad when it can't load, warn near expiry. */
export function certificationState(
  cert: SystemConfig["certification"],
  now = new Date(),
): { state: ConfigState; daysLeft: number | null } {
  if (!cert) return { state: "off", daysLeft: null };
  if (cert.error || !cert.notAfter) return { state: "bad", daysLeft: null };
  const daysLeft = Math.floor((Date.parse(cert.notAfter) - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return { state: "bad", daysLeft };
  return { state: daysLeft < CERT_WARN_DAYS ? "warn" : "ok", daysLeft };
}

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

/** pg-boss queues an admin can pause (render-lost, the dead letters, always runs). */
export const pausableQueues = ["render", "webhook", "detect-fields", "retention"] as const;
export const pausableQueueSchema = z.enum(pausableQueues);
export type PausableQueue = z.infer<typeof pausableQueueSchema>;

/** POST /api/system/queue/pause */
export const queuePauseSchema = z.object({ queue: pausableQueueSchema, paused: z.boolean() });

/** The `queues` setting: which queues are paused, shared by every worker. */
export const queueSettingsSchema = z.object({ paused: z.array(pausableQueueSchema) });
export type QueueSettings = z.infer<typeof queueSettingsSchema>;

/** The paused list after pausing or resuming one queue, in the order of `pausableQueues`. */
export const withPaused = (
  current: readonly PausableQueue[],
  queue: PausableQueue,
  paused: boolean,
) => pausableQueues.filter((q) => (q === queue ? paused : current.includes(q)));

/** POST /api/system/queue/retry-failed: every failed render job, optionally in one queue. */
export const retryFailedSchema = z.object({ queue: z.string().max(100).optional() });
