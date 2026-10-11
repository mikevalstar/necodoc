import { z } from "zod";
import { renderRequestSchema } from "./render";

// Spec: docs/features/generation-log.md

export const generationSourceSchema = z.enum(["app", "api", "share_link", "combine", "rerun"]);
export type GenerationSource = z.infer<typeof generationSourceSchema>;

export const generationStatusSchema = z.enum(["success", "error"]);
export type GenerationStatus = z.infer<typeof generationStatusSchema>;

/** Filters for listing and bulk-deleting generations. Non-admins are always scoped to themselves. */
export const generationFilterSchema = z.object({
  source: generationSourceSchema.optional(),
  status: generationStatusSchema.optional(),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type GenerationFilter = z.infer<typeof generationFilterSchema>;

export const generationListQuerySchema = generationFilterSchema.extend({
  sort: z.enum(["startedAt", "durationMs"]).default("startedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const generationSummarySchema = z.object({
  id: z.uuid(),
  source: generationSourceSchema,
  status: generationStatusSchema,
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  templateId: z.uuid().nullable(),
  templateVersionId: z.uuid().nullable(),
  rerunOfId: z.uuid().nullable(),
  filename: z.string(),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int(),
  pageCount: z.number().int().nullable(),
  size: z.number().int().nullable(),
  hasOutput: z.boolean(),
});
export type GenerationSummary = z.infer<typeof generationSummarySchema>;

export const generationDetailSchema = generationSummarySchema.extend({
  input: renderRequestSchema,
});
export type GenerationDetail = z.infer<typeof generationDetailSchema>;
