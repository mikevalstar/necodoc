import { zValidator } from "@hono/zod-validator";
import { assetKind, assetListQuerySchema, renameAssetSchema } from "@necodoc/shared";
import { and, desc, eq, ilike, like, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { sniffAssetMime } from "../asset-type";
import { db } from "../db";
import { asset, file, user } from "../db/schema";
import { deleteFiles, FileTooLargeError, fileBytes, storeFile } from "../files";
import { type AppEnv, requirePermission } from "../middleware";
import { fileHeaders } from "./http";

// Spec: docs/features/assets.md. Assets are global and immutable; only the name changes.

const idParam = zValidator("param", z.object({ id: z.uuid() }));

const assetColumns = {
  id: asset.id,
  name: asset.name,
  mimeType: asset.mimeType,
  size: file.size,
  uploadedBy: asset.uploadedBy,
  uploaderName: user.name,
  createdAt: asset.createdAt,
};

async function assetList(where?: SQL) {
  const rows = await db
    .select(assetColumns)
    .from(asset)
    .innerJoin(file, eq(file.id, asset.fileId))
    .leftJoin(user, eq(user.id, asset.uploadedBy))
    .where(where)
    .orderBy(desc(asset.createdAt));
  return rows.map((row) => ({ ...row, kind: assetKind(row.mimeType) }));
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

export const assetRoutes = new Hono<AppEnv>()
  .get(
    "/",
    requirePermission({ document: ["view"] }),
    zValidator("query", assetListQuerySchema),
    async (c) => {
      const { q, kind } = c.req.valid("query");
      return c.json(
        await assetList(
          and(
            q ? ilike(asset.name, `%${escapeLike(q)}%`) : undefined,
            kind ? like(asset.mimeType, kind === "font" ? "font/%" : "image/%") : undefined,
          ),
        ),
      );
    },
  )
  .post(
    "/",
    requirePermission({ document: ["create"] }),
    zValidator("form", z.object({ file: z.instanceof(File), name: z.string().trim().optional() })),
    async (c) => {
      const form = c.req.valid("form");
      const bytes = new Uint8Array(await form.file.arrayBuffer());
      const mimeType = sniffAssetMime(bytes);
      if (!mimeType) {
        return c.json(
          { error: "Upload a PNG, JPEG, SVG or WebP image, or a TTF, OTF or WOFF2 font" },
          415,
        );
      }
      const userId = c.get("user").id;
      try {
        const id = await db.transaction(async (tx) => {
          const fileId = await storeFile(tx, { bytes, mimeType, ownerId: userId });
          const [row] = await tx
            .insert(asset)
            .values({
              name: form.name || form.file.name || "Untitled",
              mimeType,
              fileId,
              uploadedBy: userId,
            })
            .returning({ id: asset.id });
          return row?.id;
        });
        const [created] = id ? await assetList(eq(asset.id, id)) : [];
        return c.json(created, 201);
      } catch (error) {
        if (error instanceof FileTooLargeError) return c.json({ error: error.message }, 413);
        throw error;
      }
    },
  )
  .get("/:id/file", requirePermission({ document: ["view"] }), idParam, async (c) => {
    const [row] = await db
      .select({ fileId: asset.fileId })
      .from(asset)
      .where(eq(asset.id, c.req.valid("param").id));
    const stored = row && (await fileBytes(db, row.fileId));
    if (!stored) return c.json({ error: "Asset not found" }, 404);
    return c.body(stored.bytes, 200, fileHeaders(stored.mimeType));
  })
  .patch(
    "/:id",
    requirePermission({ document: ["edit"] }),
    idParam,
    zValidator("json", renameAssetSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const [row] = await db
        .update(asset)
        .set({ name: c.req.valid("json").name })
        .where(eq(asset.id, id))
        .returning({ id: asset.id });
      if (!row) return c.json({ error: "Asset not found" }, 404);
      const [renamed] = await assetList(eq(asset.id, id));
      return c.json(renamed, 200);
    },
  )
  // No published versions exist yet, so nothing blocks deletion (docs/features/assets.md).
  .delete("/:id", requirePermission({ document: ["edit"] }), idParam, async (c) => {
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(asset)
        .where(eq(asset.id, c.req.valid("param").id))
        .returning({ fileId: asset.fileId });
      if (row) await deleteFiles(tx, [row.fileId]);
      return Boolean(row);
    });
    return deleted ? c.body(null, 204) : c.json({ error: "Asset not found" }, 404);
  });
