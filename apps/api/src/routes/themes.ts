import { zValidator } from "@hono/zod-validator";
import {
  createThemeSchema,
  type ThemeSettings,
  themeFontAssetIds,
  updateThemeSchema,
} from "@necodoc/shared";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { recordAudit } from "../audit";
import { db } from "../db";
import { asset, theme } from "../db/schema";
import { type AppEnv, idParam, requirePermission } from "../middleware";
import { themeUsages } from "../usage";

// Spec: docs/features/document-themes.md. Built-in starters are read-only.

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
  .get("/", requirePermission({ document: ["view"] }), async (c) => {
    const [rows, usages] = await Promise.all([
      db.select().from(theme).orderBy(desc(theme.builtIn), asc(theme.name)),
      themeUsages(),
    ]);
    return c.json(
      rows.map((row) => ({ ...row, templateCount: usages.get(row.id).templates.length })),
    );
  })
  // Templates using it, with published versions on an older copy marked (src/usage.ts).
  .get("/:id/usage", requirePermission({ document: ["view"] }), idParam, async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await db.select({ id: theme.id }).from(theme).where(eq(theme.id, id));
    if (!row) return c.json({ error: "Theme not found" }, 404);
    return c.json((await themeUsages()).get(id), 200);
  })
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
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(theme)
          .values({ ...body, createdBy: c.get("user").id })
          .returning();
        if (created) {
          await recordAudit(
            {
              action: "theme.created",
              target: { id: created.id, name: created.name },
              after: created,
            },
            tx,
          );
        }
        return created;
      });
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
      const [existing] = await db.select().from(theme).where(eq(theme.id, id));
      if (!existing) return c.json({ error: "Theme not found" }, 404);
      if (existing.builtIn) return c.json({ error: "Built-in themes can't be edited" }, 403);
      const error = await fontAssetError(body.settings);
      if (error) return c.json({ error }, 422);
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx.update(theme).set(body).where(eq(theme.id, id)).returning();
        await recordAudit(
          {
            action: "theme.updated",
            target: { id, name: updated?.name ?? existing.name },
            before: existing,
            after: updated,
          },
          tx,
        );
        return updated;
      });
      return c.json(row, 200);
    },
  )
  // Not refused when templates use it: published versions keep their copy, drafts lose the theme.
  .delete("/:id", requirePermission({ document: ["edit"] }), idParam, async (c) => {
    const { id } = c.req.valid("param");
    const [existing] = await db.select().from(theme).where(eq(theme.id, id));
    if (!existing) return c.json({ error: "Theme not found" }, 404);
    if (existing.builtIn) return c.json({ error: "Built-in themes can't be deleted" }, 403);
    await db.transaction(async (tx) => {
      await tx.delete(theme).where(eq(theme.id, id));
      await recordAudit(
        { action: "theme.deleted", target: { id, name: existing.name }, before: existing },
        tx,
      );
    });
    return c.body(null, 204);
  });
