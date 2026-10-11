import { z } from "zod";
import { fieldSectionsSchema } from "./fields";
import { bandSchema, pageOptionsSchema } from "./render";
import { docSchema } from "./template-doc";
import { themeInputSchema } from "./theme";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md.
// Overlay templates (docs/features/pdf-overlay-templates.md) add their own content in P4.

export const templateKindSchema = z.enum(["designed", "overlay"]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

/** A header or footer in the visual editor: its own TipTap doc, with an optional page-1 doc. */
export const visualBandSchema = z.object({
  height: bandSchema.shape.height,
  doc: docSchema,
  firstPage: docSchema.nullish(),
});
export type VisualBand = z.infer<typeof visualBandSchema>;

/**
 * Visual templates store TipTap JSON (compiled on render); code mode stores the compiled
 * HTML/Liquid, and can't go back (ADR 0016). Bands are null when the template has none.
 */
export const designedContentSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("visual"),
    body: docSchema,
    header: visualBandSchema.nullable().default(null),
    footer: visualBandSchema.nullable().default(null),
  }),
  z.object({
    mode: z.literal("code"),
    body: z.string().max(2_000_000),
    header: bandSchema.nullable().default(null),
    footer: bandSchema.nullable().default(null),
  }),
]);
export type DesignedContent = z.infer<typeof designedContentSchema>;

export const emptyDesignedContent: DesignedContent = {
  mode: "visual",
  body: { type: "doc", content: [{ type: "paragraph" }] },
  header: null,
  footer: null,
};

const templateName = z.string().trim().min(1, "Enter a name").max(200);
const description = z.string().max(2000);
const sampleData = z.record(z.string(), z.unknown());

/** Everything an editor changes on a designed template's draft. */
export const designedDraftSchema = z.object({
  kind: z.literal("designed"),
  name: templateName,
  description: description.default(""),
  sections: fieldSectionsSchema.default([]),
  /** Preview data. Not validated on save: a half-built template may not fit its own fields. */
  sampleData: sampleData.default({}),
  themeId: z.uuid().nullable().default(null),
  page: pageOptionsSchema.default(pageOptionsSchema.parse({})),
  content: designedContentSchema.default(emptyDesignedContent),
});

/** One member per kind; overlay joins in P4. */
export const createTemplateSchema = z.discriminatedUnion("kind", [designedDraftSchema]);
export type CreateTemplate = z.infer<typeof createTemplateSchema>;
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

/**
 * A partial draft update; `kind` can't change. `baseUpdatedAt` is the draft's `updatedAt` when
 * the editor opened it: if someone saved since, the update is refused with 409.
 */
export const updateTemplateSchema = designedDraftSchema
  .omit({ kind: true })
  .extend({
    description,
    sections: fieldSectionsSchema,
    sampleData,
    themeId: z.uuid().nullable(),
    page: pageOptionsSchema,
    content: designedContentSchema,
    baseUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .partial();
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>;

/** Renders the draft, or an unsaved draft the editor sends, with sample or given data. */
export const previewTemplateSchema = z.object({
  draft: designedDraftSchema.omit({ kind: true, name: true, description: true }).optional(),
  data: sampleData.optional(),
});

export const publishTemplateSchema = z.object({ note: z.string().trim().max(2000).optional() });

/** A version number, or `latest` (the newest published one). */
export const versionParamSchema = z.union([
  z.literal("latest"),
  z.coerce.number().int().positive(),
]);

export const generateFromTemplateSchema = z.object({
  data: sampleData.default({}),
  filename: z.string().trim().min(1).max(200).optional(),
});

const timestamps = {
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

/** What `GET /templates` lists. Viewers only see published, non-archived templates. */
export const templateSummarySchema = z.object({
  id: z.uuid(),
  kind: templateKindSchema,
  name: templateName,
  description,
  latestVersion: z.number().int().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  /** The draft was saved after the latest publish (or was never published). */
  hasUnpublishedChanges: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  ...timestamps,
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;

/** The draft, as editors and reviewers see it. */
export const templateSchema = designedDraftSchema.extend({
  id: z.uuid(),
  createdBy: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  ...timestamps,
});
export type Template = z.infer<typeof templateSchema>;

export const templateVersionSummarySchema = z.object({
  id: z.uuid(),
  templateId: z.uuid(),
  version: z.number().int().positive(),
  note: z.string().nullable(),
  publishedBy: z.string().nullable(),
  publisherName: z.string().nullable(),
  publishedAt: z.iso.datetime(),
});
export type TemplateVersionSummary = z.infer<typeof templateVersionSummarySchema>;

/** A published snapshot: the draft as it was, plus the theme it used, frozen. */
export const templateVersionSchema = templateVersionSummarySchema
  .extend(designedDraftSchema.shape)
  .extend({ theme: themeInputSchema.nullable() });
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
