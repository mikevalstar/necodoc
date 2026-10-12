import { z } from "zod";
import { fieldSectionsSchema } from "./fields";
import { translationsSchema } from "./locale";
import { outputOptionsSchema, outputOverridesSchema } from "./output";
import { overlayContentSchema } from "./overlay";
import { subjectSchema } from "./privacy";
import { bandSchema, pageOptionsSchema } from "./render";
import { signersSchema } from "./signing";
import { docSchema } from "./template-doc";
import { themeInputSchema } from "./theme";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md.
// Overlay templates: docs/features/pdf-overlay-templates.md (content in ./overlay.ts).

export const templateKindSchema = z.enum(["designed", "overlay"]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

/** A header or footer in the visual editor: its own TipTap doc, with an optional page-1 doc. */
export const visualBandSchema = z.object({
  height: bandSchema.shape.height,
  doc: docSchema,
  firstPage: docSchema.nullish(),
});
export type VisualBand = z.infer<typeof visualBandSchema>;

/** Template CSS, added after the theme's in body and bands. Lives in content: no extra column. */
const templateCss = z.string().max(200_000).default("");
/** Who signs (docs/features/signing-packages.md); in content too, so versions freeze them. */
const signers = signersSchema.default([]);
/** PDF/A, PDF/UA and certification (docs/features/archival-accessible-and-certified-output.md). */
const output = outputOptionsSchema.default(outputOptionsSchema.parse({}));
/** Per-language text (docs/features/document-localization.md); in content so versions freeze it. */
const translations = translationsSchema.default({});

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
    css: templateCss,
    signers,
    output,
    translations,
  }),
  z.object({
    mode: z.literal("code"),
    body: z.string().max(2_000_000),
    header: bandSchema.nullable().default(null),
    footer: bandSchema.nullable().default(null),
    css: templateCss,
    signers,
    output,
    translations,
  }),
]);
export type DesignedContent = z.infer<typeof designedContentSchema>;

export const emptyDesignedContent: DesignedContent = {
  mode: "visual",
  body: { type: "doc", content: [{ type: "paragraph" }] },
  header: null,
  footer: null,
  css: "",
  signers: [],
  output: outputOptionsSchema.parse({}),
  translations: {},
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

/** An uploaded PDF with boxes placed on it. No theme or page setup: the PDF has both. */
export const overlayDraftSchema = z.object({
  kind: z.literal("overlay"),
  name: templateName,
  description: description.default(""),
  sections: fieldSectionsSchema.default([]),
  sampleData: sampleData.default({}),
  content: overlayContentSchema,
});

/** One member per kind. */
export const createTemplateSchema = z.discriminatedUnion("kind", [
  designedDraftSchema,
  overlayDraftSchema,
]);
export type CreateTemplate = z.infer<typeof createTemplateSchema>;
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

/**
 * A partial draft update; `kind` can't change, and content must be the template's kind (the API
 * checks). Designed-only settings (theme, page) are ignored on overlay templates. `baseUpdatedAt` is the draft's `updatedAt` when
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
    content: z.union([designedContentSchema, overlayContentSchema]),
    baseUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .partial();
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>;

/** Renders the draft, or an unsaved draft the editor sends, with sample or given data. */
export const previewTemplateSchema = z.object({
  draft: z
    .discriminatedUnion("kind", [
      designedDraftSchema.omit({ name: true, description: true }),
      overlayDraftSchema.omit({ name: true, description: true }),
    ])
    .optional(),
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
  /** Answer 202 with the generation id at once instead of waiting for the PDF. */
  async: z.boolean().default(false),
  /** Overrides the template's output settings for this PDF; `lang` picks the document language. */
  output: outputOverridesSchema.optional().meta({
    description:
      "Overrides the version's output settings. `lang` makes the PDF in that language (formatting, translations, text direction).",
  }),
  subject: subjectSchema.optional(),
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

const draftMeta = {
  id: z.uuid(),
  createdBy: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  ...timestamps,
};

/** The draft, as editors and reviewers see it. */
export const templateSchema = z.discriminatedUnion("kind", [
  designedDraftSchema.extend(draftMeta),
  overlayDraftSchema.extend(draftMeta),
]);
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

/** A published snapshot: the draft as it was, plus the theme it used (designed only), frozen. */
export const templateVersionSchema = z.discriminatedUnion("kind", [
  templateVersionSummarySchema
    .extend(designedDraftSchema.shape)
    .extend({ theme: themeInputSchema.nullable() }),
  templateVersionSummarySchema.extend(overlayDraftSchema.shape),
]);
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
