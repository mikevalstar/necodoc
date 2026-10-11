import { z } from "zod";
import { themeInputSchema } from "./theme";

// Specs: docs/features/html-to-pdf-api.md, docs/features/document-templates.md.
// Mechanism: docs/adrs/0012-headless-chromium-for-html-to-pdf.md

/** Reserved origin the renderer fulfils in-process (ADR 0012). Never resolves on a real network. */
export const ASSET_ORIGIN = "https://assets.necodoc.invalid";

/** Request bodies and stored files are capped at 20 MB (ADR 0014). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const pageSizeSchema = z.enum(["Letter", "A4", "Legal"]);
export type PageSize = z.infer<typeof pageSizeSchema>;

export const orientationSchema = z.enum(["portrait", "landscape"]);

/** Lengths are millimetres. */
const mm = z.number().min(0).max(200);

export const marginsSchema = z.object({ top: mm, right: mm, bottom: mm, left: mm });
export type Margins = z.infer<typeof marginsSchema>;

export const pageOptionsSchema = z.object({
  size: pageSizeSchema.default("Letter"),
  orientation: orientationSchema.default("portrait"),
  margins: marginsSchema.default({ top: 20, right: 20, bottom: 20, left: 20 }),
});
export type PageOptions = z.infer<typeof pageOptionsSchema>;

/** A header or footer: full HTML/Liquid at a fixed height, with an optional page-1 variant. */
export const bandSchema = z.object({
  html: z.string(),
  height: mm.positive(),
  firstPageHtml: z.string().optional(),
});
export type Band = z.infer<typeof bandSchema>;

export const renderRequestSchema = z
  .object({
    html: z.string().min(1, "Enter some HTML"),
    css: z.string().optional(),
    themeId: z.uuid().optional(),
    /** Unsaved theme settings, for the theme editor's preview. */
    themeDraft: themeInputSchema.optional(),
    header: bandSchema.optional(),
    footer: bandSchema.optional(),
    page: pageOptionsSchema.default(pageOptionsSchema.parse({})),
    data: z.record(z.string(), z.unknown()).default({}),
    filename: z.string().trim().min(1).max(200).optional(),
    /** Previews render without a generation log entry. */
    preview: z.boolean().default(false),
  })
  .refine((r) => !(r.themeId && r.themeDraft), {
    message: "Send themeId or themeDraft, not both",
    path: ["themeDraft"],
  });
export type RenderRequest = z.infer<typeof renderRequestSchema>;
export type RenderRequestInput = z.input<typeof renderRequestSchema>;
