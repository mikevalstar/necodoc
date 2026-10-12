import { z } from "zod";
import { outputOptionsSchema, outputProfileSchema } from "./output";
import { overlayRenderRequestSchema } from "./overlay";
import { renderRequestSchema } from "./render";
import { signingPackageSchema } from "./signing";

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

/**
 * Where a render's time went, in milliseconds. Bands include their Liquid; stamping is pdf-lib.
 * Overlays use liquidMs (box values) and stampMs (filling, drawing, saving) only.
 */
export const renderTimingsSchema = z.object({
  liquidMs: z.number().int(),
  chromiumMs: z.number().int(),
  bandsMs: z.number().int(),
  stampMs: z.number().int(),
  /** PDF/A, PDF/UA and certification; 0 on generations from before they existed. */
  finishMs: z.number().int().default(0),
});
export type RenderTimings = z.infer<typeof renderTimingsSchema>;

/** A comma-separated query value ("api,batch") as a list of one or more items. */
const commaList = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1));

/** Filters for listing, exporting and bulk-deleting generations. Non-admins only see their own. */
export const generationFilterSchema = z.object({
  /** One or more, comma-separated. */
  source: commaList(generationSourceSchema).optional(),
  /** One or more, comma-separated. */
  status: commaList(generationStatusSchema).optional(),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  apiKeyId: z.string().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Free text: filename, template name, error or request id (substring), or a generation id. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Only entries at least this slow, end to end. */
  minTotalMs: z.coerce.number().int().min(0).optional(),
  /** Only entries faster than this (exclusive), end to end. */
  maxTotalMs: z.coerce.number().int().min(0).optional(),
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

/**
 * Bucket edges for the render-time histogram, in ms: roughly log-spaced from 0.1 s to 10 s. The
 * buckets are [0, 100), [100, 150), … [7000, 10000) and 10 s and over.
 */
export const RENDER_TIME_EDGES_MS = [
  100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000, 10000,
] as const;

/** GET /generations/render-times: end-to-end times of the filtered entries, ignoring min/max. */
export const renderTimeHistogramSchema = z.object({
  buckets: z.array(
    z.object({
      minMs: z.number().int(),
      /** Exclusive; null for the last, open-ended bucket. */
      maxMs: z.number().int().nullable(),
      count: z.number().int(),
    }),
  ),
  /** Entries with a time (finished ones). */
  timed: z.number().int(),
  p50Ms: z.number().int().nullable(),
  p95Ms: z.number().int().nullable(),
  p99Ms: z.number().int().nullable(),
  /** Matching entries that failed. */
  failed: z.number().int(),
});
export type RenderTimeHistogram = z.infer<typeof renderTimeHistogramSchema>;

const timestamp = z.iso.datetime();
const ms = z.number().int();

export const generationSummarySchema = z.object({
  id: z.uuid(),
  source: generationSourceSchema,
  status: generationStatusSchema,
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  /** The key's name, as it is now. */
  apiKeyName: z.string().nullable(),
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

/**
 * A packet (docs/features/combining-pdfs-into-packets.md): stored PDFs merged in order. Each part
 * is a file; parts that came from the log keep their generation id.
 */
export const combineRenderRequestSchema = z.object({
  kind: z.literal("combine"),
  parts: z.array(z.object({ fileId: z.uuid(), generationId: z.uuid().optional() })).min(1),
  filename: z.string().trim().min(1).max(200).optional(),
  preview: z.boolean().default(false),
  output: outputOptionsSchema.optional(),
});
export type CombineRenderRequest = z.infer<typeof combineRenderRequestSchema>;

/** What a generation renders: HTML (designed templates, the render API), a PDF overlay, or a packet. */
export const generationInputSchema = z.union([
  overlayRenderRequestSchema,
  combineRenderRequestSchema,
  renderRequestSchema,
]);
export type RenderInput = z.infer<typeof generationInputSchema>;

export const generationDetailSchema = generationSummarySchema.extend({
  /** Null once the retention setting has removed it. */
  input: generationInputSchema.nullable(),
  timings: renderTimingsSchema.nullable(),
  requestId: z.string().nullable(),
  /** Signers and sign boxes (docs/features/signing-packages.md); null without any. */
  signing: signingPackageSchema.nullable(),
  /** PDF/A, PDF/UA and certification as applied; null when none was asked for. */
  outputProfile: outputProfileSchema.nullable(),
  /** Who it's about (docs/features/personal-data-masking-and-erasure.md). */
  subject: z.string().nullable(),
});
export type GenerationDetail = z.infer<typeof generationDetailSchema>;

/** What a generate call answers once its wait runs out, or at once in async mode. */
export const pendingGenerationSchema = z.object({
  generationId: z.uuid(),
  status: generationStatusSchema,
});
export type PendingGeneration = z.infer<typeof pendingGenerationSchema>;

/** Longest a signed download link can live (ADR 0023). */
export const MAX_DOWNLOAD_LINK_SECONDS = 7 * 24 * 60 * 60;

/** POST /generations/:id/link: a signed link to the PDF that works without a session. */
export const downloadLinkRequestSchema = z.object({
  expiresInSeconds: z.int().min(60).max(MAX_DOWNLOAD_LINK_SECONDS).default(3600),
});
export type DownloadLinkRequest = z.infer<typeof downloadLinkRequestSchema>;

export const downloadLinkSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export type DownloadLink = z.infer<typeof downloadLinkSchema>;
