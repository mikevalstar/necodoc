import { z } from "zod";

// Spec: docs/features/assets.md

export const assetMimeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
  "font/ttf",
  "font/otf",
  "font/woff2",
]);
export type AssetMime = z.infer<typeof assetMimeSchema>;

export const assetKindSchema = z.enum(["image", "font"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetKind = (mime: AssetMime): AssetKind =>
  mime.startsWith("font/") ? "font" : "image";

const assetName = z.string().trim().min(1, "Enter a name").max(200);

export const renameAssetSchema = z.object({ name: assetName });

export const assetListQuerySchema = z.object({
  q: z.string().trim().optional(),
  kind: assetKindSchema.optional(),
});

export const assetSchema = z.object({
  id: z.uuid(),
  name: assetName,
  kind: assetKindSchema,
  mimeType: assetMimeSchema,
  size: z.number().int(),
  uploadedBy: z.string().nullable(),
  uploaderName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof assetSchema>;

/** What references an asset (docs/features/assets.md). Names are the drafts'. */
export const assetUsageSchema = z.object({
  templates: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      archived: z.boolean(),
      /** The working draft references it. */
      draft: z.boolean(),
      /** Published versions that reference it, newest first. */
      versions: z.array(z.number().int()),
    }),
  ),
  themes: z.array(z.object({ id: z.uuid(), name: z.string() })),
  snippets: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type AssetUsage = z.infer<typeof assetUsageSchema>;

export const assetListItemSchema = assetSchema.extend({ usage: assetUsageSchema });
export type AssetListItem = z.infer<typeof assetListItemSchema>;

export const usageCount = (usage: AssetUsage) =>
  usage.templates.length + usage.themes.length + usage.snippets.length;

/** Templates whose published versions need the asset: deleting it is refused while any exist. */
export const blockingTemplates = (usage: AssetUsage) =>
  usage.templates.filter((t) => !t.archived && t.versions.length > 0);
