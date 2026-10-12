import { z } from "zod";
import { batchJsonSchema, batchSummarySchema } from "./batch";
import { generationStatusSchema, generationSummarySchema } from "./generation";
import { outputOptionsSchema, outputProfileSchema } from "./output";
import { subjectSchema } from "./privacy";
import { renderRequestSchema } from "./render";
import {
  signingFormatSchema,
  signingPackageSchema,
  signingRequestSchema,
  tabPlacementSchema,
} from "./signing";
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

/** Render and generate only: packets don't carry signing packages. */
const signingOption = { signing: signingRequestSchema.optional() };

// Unsaved theme drafts and previews are the app's; the public render always logs. `signing` is
// the public option below, not the renderer's.
const {
  themeDraft: _themeDraft,
  preview: _preview,
  signing: _signing,
  ...renderFields
} = renderRequestSchema.shape;

export const v1RenderSchema = z
  .object({
    ...renderFields,
    ...responseOptions,
    ...signingOption,
    subject: subjectSchema.optional(),
  })
  .meta({ id: "RenderRequest", description: "HTML (Liquid allowed) to render as a PDF." });

export const v1GenerateSchema = generateFromTemplateSchema
  .extend({ ...responseOptions, ...signingOption })
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
    output: outputOptionsSchema.optional(),
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
  .extend({
    requestId: z.string().nullable(),
    outputProfile: outputProfileSchema.nullable().meta({
      description: "PDF/A, PDF/UA and certification as applied; null when none was asked for.",
    }),
  })
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

/** GET .../signing-package: which provider JSON to build. Repeat `formats` for several. */
export const signingPackageQuerySchema = z.object({
  formats: z
    .union([signingFormatSchema, z.array(signingFormatSchema)])
    .optional()
    .meta({ description: "Provider JSON to include (default `docusign`). Repeat for several." }),
  embedPdf: z
    .enum(["true", "false"])
    .optional()
    .meta({ description: "Put the PDF in provider JSON as base64 (default `true`)." }),
  placement: tabPlacementSchema
    .optional()
    .meta({ description: "DocuSign tabs by page coordinates (default) or anchor string." }),
});

export const v1SigningPackageSchema = signingPackageSchema
  .extend({
    generationId: z.uuid(),
    filename: z.string(),
    pageCount: z.int(),
    pdfUrl: z.url().meta({ description: "Signed; works without a key for 1 hour." }),
    pdfPath: z.string().meta({ description: "`/api/v1/generations/{id}/pdf`, with a key." }),
    formats: z
      .object({
        docusign: z.looseObject({}).optional().meta({
          description:
            "DocuSign eSignature v2.1 envelope definition: POST it to /restapi/v2.1/accounts/{accountId}/envelopes.",
        }),
        dropbox_sign: z.looseObject({}).optional().meta({
          description:
            "Dropbox Sign `signers` and `form_fields_per_document` for /signature_request/send.",
        }),
        adobe_sign: z.looseObject({}).optional().meta({
          description:
            "Adobe Acrobat Sign `participantSetsInfo` (POST /agreements) and `formFields` (PUT /agreements/{id}/formFields).",
        }),
      })
      .meta({ description: "Provider JSON, as asked for in `formats`." }),
  })
  .meta({
    id: "SigningPackage",
    description: "The PDF's signers and sign boxes, for an e-sign provider.",
  });
export type V1SigningPackage = z.infer<typeof v1SigningPackageSchema>;
