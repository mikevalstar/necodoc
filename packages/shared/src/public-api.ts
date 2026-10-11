import { z } from "zod";
import { batchJsonSchema, batchSummarySchema } from "./batch";
import { generationStatusSchema, generationSummarySchema } from "./generation";
import { renderRequestSchema } from "./render";
import {
  generateFromTemplateSchema,
  templateSummarySchema,
  templateVersionSummarySchema,
} from "./template";

// Spec: docs/features/html-to-pdf-api.md. The /api/v1 request and response bodies; the OpenAPI
// document is generated from these (ADR 0030), so `.meta()` descriptions show in the reference.

const responseOptions = {
  response: z
    .enum(["pdf", "json"])
    .default("pdf")
    .meta({ description: "`pdf` returns the bytes; `json` returns the generation and a link." }),
  async: z
    .boolean()
    .default(false)
    .meta({ description: "Answer 202 with the generation id at once instead of waiting." }),
};

// Unsaved theme drafts and previews are the app's; the public render always logs.
const { themeDraft: _themeDraft, preview: _preview, ...renderFields } = renderRequestSchema.shape;

export const v1RenderSchema = z
  .object({ ...renderFields, ...responseOptions })
  .meta({ id: "RenderRequest", description: "HTML (Liquid allowed) to render as a PDF." });

export const v1GenerateSchema = generateFromTemplateSchema
  .extend(responseOptions)
  .meta({ id: "GenerateRequest", description: "Data for a published template version." });

export const v1BatchSchema = batchJsonSchema.meta({ id: "BatchRequest" });

/** A PDF to put in a packet: a generation of yours, or one you upload (base64). */
export const combineInputSchema = z.union([
  z.object({ generationId: z.uuid() }),
  z.object({
    pdf: z.base64().meta({ description: "The PDF's bytes, base64-encoded." }),
    filename: z.string().max(200).optional(),
  }),
]);
export type CombineInput = z.infer<typeof combineInputSchema>;

export const v1CombineSchema = z
  .object({
    inputs: z.array(combineInputSchema).min(1).max(100),
    filename: z.string().trim().min(1).max(200).optional(),
    ...responseOptions,
  })
  .meta({ id: "CombineRequest", description: "PDFs to merge, in order. Forms are flattened." });

export const v1ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    generationId: z.uuid().optional(),
  })
  .meta({ id: "Error" });
export type V1Error = z.infer<typeof v1ErrorSchema>;

export const v1GenerationResultSchema = z
  .object({
    generationId: z.uuid(),
    status: z.literal("success"),
    filename: z.string(),
    pageCount: z.int(),
    size: z.int(),
    downloadUrl: z.url().meta({ description: "Signed; works without a key for 1 hour." }),
    pdfPath: z.string().meta({ description: "`/api/v1/generations/{id}/pdf`, with a key." }),
  })
  .meta({ id: "GenerationResult" });

export const v1PendingSchema = z
  .object({ generationId: z.uuid(), status: generationStatusSchema })
  .meta({ id: "PendingGeneration" });

export const v1GenerationSchema = generationSummarySchema
  .extend({ requestId: z.string().nullable() })
  .meta({ id: "Generation" });

export const v1TemplateSchema = templateSummarySchema
  .omit({ hasUnpublishedChanges: true, archivedAt: true })
  .meta({ id: "Template" });

export const v1TemplateDetailSchema = v1TemplateSchema
  .extend({ versions: z.array(templateVersionSummarySchema.omit({ publishedBy: true })) })
  .meta({ id: "TemplateDetail" });

export const v1BatchSummarySchema = batchSummarySchema.meta({ id: "Batch" });

export const jsonSchemaDocumentSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: "JsonSchema", description: "A JSON Schema (draft 2020-12) for the data." });
