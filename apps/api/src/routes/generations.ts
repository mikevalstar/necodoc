import { zValidator } from "@hono/zod-validator";
import {
  type GenerationFilter,
  generationFilterSchema,
  generationListQuerySchema,
  parseRoles,
  toCsv,
} from "@necodoc/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { generation, template, user } from "../db/schema";
import { deleteFiles, fileBytes } from "../files";
import { generate } from "../generate";
import { type AppEnv, requirePermission, requireRole, type SignedInEnv } from "../middleware";
import { pdfHeaders } from "./http";

// Spec: docs/features/generation-log.md. Admins see every entry; everyone else only their own.
// Rows are written by src/generate.ts (queued) and the worker that renders them.

type SignedInUser = SignedInEnv["Variables"]["user"];

const isAdmin = (actor: SignedInUser) => parseRoles(actor.role).includes("admin");

function filterWhere(actor: SignedInUser, filter: GenerationFilter) {
  const userId = isAdmin(actor) ? filter.userId : actor.id;
  return and(
    userId ? eq(generation.userId, userId) : undefined,
    filter.source ? eq(generation.source, filter.source) : undefined,
    filter.status ? eq(generation.status, filter.status) : undefined,
    filter.templateId ? eq(generation.templateId, filter.templateId) : undefined,
    filter.batchId ? eq(generation.batchId, filter.batchId) : undefined,
    filter.from ? gte(generation.queuedAt, new Date(filter.from)) : undefined,
    filter.to ? lte(generation.queuedAt, new Date(filter.to)) : undefined,
    filter.q ? textMatch(filter.q) : undefined,
    filter.minTotalMs !== undefined ? gte(generation.totalMs, filter.minTotalMs) : undefined,
    filter.minQueueWaitMs !== undefined
      ? gte(generation.queueWaitMs, filter.minQueueWaitMs)
      : undefined,
  );
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/** Substring over filename, error, request id and template name (trigram-indexed), or an id. */
function textMatch(q: string) {
  if (z.uuid().safeParse(q).success) {
    return or(eq(generation.id, q), eq(generation.batchId, q), eq(generation.templateId, q));
  }
  const pattern = `%${escapeLike(q)}%`;
  return or(
    ilike(generation.filename, pattern),
    ilike(generation.error, pattern),
    ilike(generation.requestId, pattern),
    inArray(
      generation.templateId,
      db.select({ id: template.id }).from(template).where(ilike(template.name, pattern)),
    ),
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
  templateName: template.name,
  rerunOfId: generation.rerunOfId,
  batchId: generation.batchId,
  batchRow: generation.batchRow,
  filename: generation.filename,
  error: generation.error,
  warnings: generation.warnings,
  queuedAt: generation.queuedAt,
  startedAt: generation.startedAt,
  finishedAt: generation.finishedAt,
  durationMs: generation.durationMs,
  queueWaitMs: generation.queueWaitMs,
  totalMs: generation.totalMs,
  attempts: generation.attempts,
  workerId: generation.workerId,
  pageCount: generation.pageCount,
  size: generation.size,
  hasOutput: isNotNull(generation.outputFileId).mapWith(Boolean),
};

/** Metadata only: the export never includes inputs or PDFs. */
const exportColumns = [
  "id",
  "queuedAt",
  "startedAt",
  "finishedAt",
  "source",
  "status",
  "userName",
  "userId",
  "templateId",
  "templateVersionId",
  "templateName",
  "batchId",
  "batchRow",
  "rerunOfId",
  "filename",
  "pageCount",
  "size",
  "queueWaitMs",
  "durationMs",
  "totalMs",
  "attempts",
  "workerId",
  "error",
  "warnings",
] as const satisfies readonly (keyof typeof summaryColumns)[];

const EXPORT_LIMIT = 100_000;

const selectSummaries = () =>
  db
    .select(summaryColumns)
    .from(generation)
    .leftJoin(user, eq(user.id, generation.userId))
    .leftJoin(template, eq(template.id, generation.templateId));

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
        // Plain asc/desc so the per-column indexes serve the sort; rows without a value yet
        // (unfinished) sort as Postgres puts nulls: last ascending, first descending.
        .orderBy(direction(generation[sort]), direction(generation.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(generation).where(where),
    ]);
    return c.json({ items, total: total?.count ?? 0 });
  })
  .get("/export.csv", canView, zValidator("query", generationFilterSchema), async (c) => {
    const rows = await selectSummaries()
      .where(filterWhere(c.get("user"), c.req.valid("query")))
      .orderBy(desc(generation.queuedAt))
      .limit(EXPORT_LIMIT);
    const csv = toCsv([
      exportColumns,
      ...rows.map((row) =>
        exportColumns.map((column) => {
          const value = row[column];
          return value instanceof Date
            ? value.toISOString()
            : Array.isArray(value)
              ? value.join("; ")
              : value;
        }),
      ),
    ]);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="generations-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  })
  .delete("/", requireRole("admin"), zValidator("query", generationFilterSchema), async (c) => {
    const where = filterWhere(c.get("user"), c.req.valid("query"));
    if (!where) return c.json({ error: "Pick at least one filter to bulk delete" }, 422);
    const deleted = await deleteGenerations(where);
    return c.json({ deleted }, 200);
  })
  .get("/:id", canView, idParam, async (c) => {
    const [row] = await db
      .select({
        ...summaryColumns,
        input: generation.input,
        timings: generation.timings,
        requestId: generation.requestId,
      })
      .from(generation)
      .leftJoin(user, eq(user.id, generation.userId))
      .leftJoin(template, eq(template.id, generation.templateId))
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
    if (!original.input) {
      return c.json({ error: "The input was removed by the retention setting" }, 409);
    }
    // Waits like any synchronous render; past the wait it answers with the entry still queued.
    const result = await generate({
      request: original.input,
      source: "rerun",
      userId: actor.id,
      requestId: c.get("requestId"),
      rerunOfId: original.id,
      ...(original.templateId && original.templateVersionId
        ? { template: { id: original.templateId, versionId: original.templateVersionId } }
        : {}),
      wait: true,
    });
    const [rerun] = await selectSummaries().where(eq(generation.id, result.generationId));
    return c.json(rerun, 201);
  })
  .delete("/:id", canView, idParam, async (c) => {
    const deleted = await deleteGenerations(visible(c.get("user"), c.req.valid("param").id));
    return deleted ? c.body(null, 204) : c.json({ error: "Generation not found" }, 404);
  });
