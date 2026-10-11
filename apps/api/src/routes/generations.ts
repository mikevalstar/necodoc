import { zValidator } from "@hono/zod-validator";
import {
  type GenerationFilter,
  generationFilterSchema,
  generationListQuerySchema,
  parseRoles,
} from "@necodoc/shared";
import { and, asc, count, desc, eq, gte, isNotNull, lte, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { generation, user } from "../db/schema";
import { deleteFiles, fileBytes } from "../files";
import { generate } from "../generate";
import { type AppEnv, requirePermission, requireRole, type SignedInEnv } from "../middleware";
import { pdfHeaders } from "./http";

// Spec: docs/features/generation-log.md. Admins see every entry; everyone else only their own.

type SignedInUser = SignedInEnv["Variables"]["user"];

const isAdmin = (actor: SignedInUser) => parseRoles(actor.role).includes("admin");

function filterWhere(actor: SignedInUser, filter: GenerationFilter) {
  const userId = isAdmin(actor) ? filter.userId : actor.id;
  return and(
    userId ? eq(generation.userId, userId) : undefined,
    filter.source ? eq(generation.source, filter.source) : undefined,
    filter.status ? eq(generation.status, filter.status) : undefined,
    filter.templateId ? eq(generation.templateId, filter.templateId) : undefined,
    filter.from ? gte(generation.startedAt, new Date(filter.from)) : undefined,
    filter.to ? lte(generation.startedAt, new Date(filter.to)) : undefined,
  );
}

/** Matches one entry, if the actor may see it. */
const visible = (actor: SignedInUser, id: string) =>
  isAdmin(actor)
    ? eq(generation.id, id)
    : and(eq(generation.id, id), eq(generation.userId, actor.id));

const summaryColumns = {
  id: generation.id,
  source: generation.source,
  status: generation.status,
  userId: generation.userId,
  userName: user.name,
  apiKeyId: generation.apiKeyId,
  templateId: generation.templateId,
  templateVersionId: generation.templateVersionId,
  rerunOfId: generation.rerunOfId,
  filename: generation.filename,
  error: generation.error,
  warnings: generation.warnings,
  startedAt: generation.startedAt,
  durationMs: generation.durationMs,
  pageCount: generation.pageCount,
  size: generation.size,
  hasOutput: isNotNull(generation.outputFileId).mapWith(Boolean),
};

const selectSummaries = () =>
  db.select(summaryColumns).from(generation).leftJoin(user, eq(user.id, generation.userId));

const idParam = zValidator("param", z.object({ id: z.uuid() }));
const canView = requirePermission({ document: ["view"] });

/** Deletes entries and their stored PDFs (ADR 0014: the output goes with the row). */
async function deleteGenerations(where: SQL | undefined) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(generation)
      .where(where)
      .returning({ outputFileId: generation.outputFileId });
    await deleteFiles(
      tx,
      rows.flatMap((row) => (row.outputFileId ? [row.outputFileId] : [])),
    );
    return rows.length;
  });
}

export const generationRoutes = new Hono<AppEnv>()
  .get("/", canView, zValidator("query", generationListQuerySchema), async (c) => {
    const { sort, order, limit, offset, ...filter } = c.req.valid("query");
    const where = filterWhere(c.get("user"), filter);
    const direction = order === "asc" ? asc : desc;
    const [items, [total]] = await Promise.all([
      selectSummaries()
        .where(where)
        .orderBy(direction(generation[sort]), desc(generation.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(generation).where(where),
    ]);
    return c.json({ items, total: total?.count ?? 0 });
  })
  .delete("/", requireRole("admin"), zValidator("query", generationFilterSchema), async (c) => {
    const where = filterWhere(c.get("user"), c.req.valid("query"));
    if (!where) return c.json({ error: "Pick at least one filter to bulk delete" }, 422);
    const deleted = await deleteGenerations(where);
    return c.json({ deleted }, 200);
  })
  .get("/:id", canView, idParam, async (c) => {
    const [row] = await db
      .select({ ...summaryColumns, input: generation.input })
      .from(generation)
      .leftJoin(user, eq(user.id, generation.userId))
      .where(visible(c.get("user"), c.req.valid("param").id));
    return row ? c.json(row, 200) : c.json({ error: "Generation not found" }, 404);
  })
  .get("/:id/pdf", canView, idParam, async (c) => {
    const [row] = await db
      .select({ fileId: generation.outputFileId, filename: generation.filename })
      .from(generation)
      .where(visible(c.get("user"), c.req.valid("param").id));
    const stored = row?.fileId ? await fileBytes(db, row.fileId) : null;
    if (!row || !stored) return c.json({ error: "No PDF for this generation" }, 404);
    return c.body(stored.bytes, 200, pdfHeaders(row.filename));
  })
  .post("/:id/rerun", canView, idParam, async (c) => {
    const actor = c.get("user");
    const [original] = await db
      .select({
        id: generation.id,
        input: generation.input,
        templateId: generation.templateId,
        templateVersionId: generation.templateVersionId,
      })
      .from(generation)
      .where(visible(actor, c.req.valid("param").id));
    if (!original) return c.json({ error: "Generation not found" }, 404);
    const result = await generate({
      request: { ...original.input, preview: false },
      source: "rerun",
      userId: actor.id,
      rerunOfId: original.id,
      ...(original.templateId && original.templateVersionId
        ? { template: { id: original.templateId, versionId: original.templateVersionId } }
        : {}),
    });
    const [rerun] = result.generationId
      ? await selectSummaries().where(eq(generation.id, result.generationId))
      : [];
    return c.json(rerun, 201);
  })
  .delete("/:id", canView, idParam, async (c) => {
    const deleted = await deleteGenerations(visible(c.get("user"), c.req.valid("param").id));
    return deleted ? c.body(null, 204) : c.json({ error: "Generation not found" }, 404);
  });
