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
