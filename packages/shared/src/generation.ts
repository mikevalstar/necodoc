import { z } from "zod";
import { renderRequestSchema } from "./render";

// Specs: docs/features/generation-log.md, docs/features/render-queue-batch-jobs-and-scaling.md

export const generationSourceSchema = z.enum([
  "app",
  "api",
  "share_link",
  "combine",
  "rerun",
  "batch",
]);
export type GenerationSource = z.infer<typeof generationSourceSchema>;

/** queued → running → success | error. Only queued rows (batch rows) can be cancelled. */
export const generationStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "error",
  "cancelled",
]);
export type GenerationStatus = z.infer<typeof generationStatusSchema>;

/** Finished means nothing will change it any more. */
export const isFinishedStatus = (status: GenerationStatus) =>
  status === "success" || status === "error" || status === "cancelled";

/** Where a render's time went, in milliseconds. Bands include their Liquid; stamping is pdf-lib. */
export const renderTimingsSchema = z.object({
  liquidMs: z.number().int(),
  chromiumMs: z.number().int(),
  bandsMs: z.number().int(),
  stampMs: z.number().int(),
});
export type RenderTimings = z.infer<typeof renderTimingsSchema>;

/** Filters for listing, exporting and bulk-deleting generations. Non-admins only see their own. */
export const generationFilterSchema = z.object({
  source: generationSourceSchema.optional(),
  status: generationStatusSchema.optional(),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Free text: filename, template name, error or request id (substring), or a generation id. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Only entries at least this slow, end to end. */
  minTotalMs: z.coerce.number().int().min(0).optional(),
  minQueueWaitMs: z.coerce.number().int().min(0).optional(),
});
export type GenerationFilter = z.infer<typeof generationFilterSchema>;

export const generationSortSchema = z.enum([
  "queuedAt",
  "startedAt",
  "finishedAt",
  "durationMs",
  "totalMs",
  "queueWaitMs",
  "pageCount",
  "size",
  "attempts",
  "filename",
  "batchRow",
]);
export type GenerationSort = z.infer<typeof generationSortSchema>;

export const generationListQuerySchema = generationFilterSchema.extend({
  sort: generationSortSchema.default("queuedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const timestamp = z.iso.datetime();
const ms = z.number().int();

export const generationSummarySchema = z.object({
  id: z.uuid(),
  source: generationSourceSchema,
  status: generationStatusSchema,
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  templateId: z.uuid().nullable(),
  templateVersionId: z.uuid().nullable(),
  /** The template's current name (null for HTML renders or deleted templates). */
  templateName: z.string().nullable(),
  rerunOfId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  batchRow: z.number().int().nullable(),
  filename: z.string(),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
  queuedAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  /** Run time on the worker. */
  durationMs: ms.nullable(),
  queueWaitMs: ms.nullable(),
  /** Queued to finished. */
  totalMs: ms.nullable(),
  attempts: z.number().int(),
  workerId: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  size: z.number().int().nullable(),
  hasOutput: z.boolean(),
});
export type GenerationSummary = z.infer<typeof generationSummarySchema>;

export const generationDetailSchema = generationSummarySchema.extend({
  /** Null once the retention setting has removed it. */
  input: renderRequestSchema.nullable(),
  timings: renderTimingsSchema.nullable(),
  requestId: z.string().nullable(),
});
export type GenerationDetail = z.infer<typeof generationDetailSchema>;

/** What a generate call answers once its wait runs out, or at once in async mode. */
export const pendingGenerationSchema = z.object({
  generationId: z.uuid(),
  status: generationStatusSchema,
});
export type PendingGeneration = z.infer<typeof pendingGenerationSchema>;
