import { zValidator } from "@hono/zod-validator";
import {
  createThemeSchema,
  type ThemeSettings,
  themeFontAssetIds,
  updateThemeSchema,
} from "@necodoc/shared";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { asset, theme } from "../db/schema";
import { type AppEnv, requirePermission } from "../middleware";

// Spec: docs/features/document-themes.md. Built-in starters are read-only.

const idParam = zValidator("param", z.object({ id: z.uuid() }));

/** Every font asset a theme names must exist and be a font. */
async function fontAssetError(settings: ThemeSettings | undefined) {
  const ids = settings ? themeFontAssetIds(settings) : [];
  if (!ids.length) return null;
  const fonts = await db
    .select({ id: asset.id, mimeType: asset.mimeType })
    .from(asset)
    .where(inArray(asset.id, ids));
  const missing = ids.find(
    (id) => !fonts.some((f) => f.id === id && f.mimeType.startsWith("font/")),
  );
  return missing ? `Font asset ${missing} isn't an uploaded font` : null;
}

export const themeRoutes = new Hono<AppEnv>()
  .get("/", requirePermission({ document: ["view"] }), async (c) =>
    c.json(await db.select().from(theme).orderBy(desc(theme.builtIn), asc(theme.name))),
  )
  .get("/:id", requirePermission({ document: ["view"] }), idParam, async (c) => {
    const [row] = await db
      .select()
      .from(theme)
      .where(eq(theme.id, c.req.valid("param").id));
    return row ? c.json(row) : c.json({ error: "Theme not found" }, 404);
  })
  .post(
    "/",
    requirePermission({ document: ["create"] }),
    zValidator("json", createThemeSchema),
    async (c) => {
      const body = c.req.valid("json");
      const error = await fontAssetError(body.settings);
      if (error) return c.json({ error }, 422);
      const [row] = await db
        .insert(theme)
        .values({ ...body, createdBy: c.get("user").id })
        .returning();
      return c.json(row, 201);
    },
  )
  .patch(
    "/:id",
    requirePermission({ document: ["edit"] }),
    idParam,
    zValidator("json", updateThemeSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [existing] = await db
        .select({ builtIn: theme.builtIn })
        .from(theme)
        .where(eq(theme.id, id));
      if (!existing) return c.json({ error: "Theme not found" }, 404);
      if (existing.builtIn) return c.json({ error: "Built-in themes can't be edited" }, 403);
      const error = await fontAssetError(body.settings);
      if (error) return c.json({ error }, 422);
      const [row] = await db.update(theme).set(body).where(eq(theme.id, id)).returning();
      return c.json(row, 200);
    },
  )
  .delete("/:id", requirePermission({ document: ["edit"] }), idParam, async (c) => {
    const { id } = c.req.valid("param");
    const [existing] = await db
      .select({ builtIn: theme.builtIn })
      .from(theme)
      .where(eq(theme.id, id));
    if (!existing) return c.json({ error: "Theme not found" }, 404);
    if (existing.builtIn) return c.json({ error: "Built-in themes can't be deleted" }, 403);
    await db.delete(theme).where(eq(theme.id, id));
    return c.body(null, 204);
  });
