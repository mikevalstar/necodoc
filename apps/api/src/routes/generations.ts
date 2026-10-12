import { zValidator } from "@hono/zod-validator";
import {
  downloadLinkRequestSchema,
  type GenerationFilter,
  generationFilterSchema,
  generationListQuerySchema,
  RENDER_TIME_EDGES_MS,
  type RenderTimeHistogram,
  signingPackageQuerySchema,
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
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db, escapeLike } from "../db";
import { file, generation, template } from "../db/schema";
import { mintLink, serveFile } from "../download";
import { deleteFiles, deleteObjects } from "../files";
import { generate } from "../generate";
import { selectSummaries, type summaryColumns } from "../generations";
import {
  type AppEnv,
  canView,
  demo,
  idParam,
  isAdmin,
  requireRole,
  type SignedInEnv,
} from "../middleware";
import { maskedInput } from "../privacy";
import { signingQueryOptions, signingResponse } from "../signing-package";

// Spec: docs/features/generation-log.md. Admins see every entry; everyone else only their own.
// Rows are written by src/generate.ts (queued) and the worker that renders them.

type SignedInUser = SignedInEnv["Variables"]["user"];

function filterWhere(actor: SignedInUser, filter: GenerationFilter) {
  const userId = isAdmin(actor) ? filter.userId : actor.id;
  return and(
    userId ? eq(generation.userId, userId) : undefined,
    filter.source ? inArray(generation.source, filter.source) : undefined,
    filter.status ? inArray(generation.status, filter.status) : undefined,
    filter.templateId ? eq(generation.templateId, filter.templateId) : undefined,
    filter.batchId ? eq(generation.batchId, filter.batchId) : undefined,
    filter.apiKeyId ? eq(generation.apiKeyId, filter.apiKeyId) : undefined,
    filter.from ? gte(generation.queuedAt, new Date(filter.from)) : undefined,
    filter.to ? lte(generation.queuedAt, new Date(filter.to)) : undefined,
    filter.q ? textMatch(filter.q) : undefined,
    filter.minTotalMs !== undefined ? gte(generation.totalMs, filter.minTotalMs) : undefined,
    filter.maxTotalMs !== undefined ? lt(generation.totalMs, filter.maxTotalMs) : undefined,
    filter.minQueueWaitMs !== undefined
      ? gte(generation.queueWaitMs, filter.minQueueWaitMs)
      : undefined,
  );
}

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
  "apiKeyId",
  "apiKeyName",
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

/** Deletes entries and their stored PDFs: rows first, then the objects once that commits. */
async function deleteGenerations(where: SQL | undefined) {
  const { deleted, objects } = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(generation)
      .where(where)
      .returning({ outputFileId: generation.outputFileId });
    const fileIds = rows.flatMap((row) => (row.outputFileId ? [row.outputFileId] : []));
    return { deleted: rows.length, objects: await deleteFiles(tx, inArray(file.id, fileIds)) };
  });
  await deleteObjects(objects);
  return deleted;
}

/** The entry's stored PDF, if the actor may see it. */
const findOutput = async (actor: SignedInUser, id: string) => {
  const [row] = await db
    .select({ fileId: generation.outputFileId, filename: generation.filename })
    .from(generation)
    .where(visible(actor, id));
  return row?.fileId ? { fileId: row.fileId, filename: row.filename } : null;
};

export const generationRoutes = new Hono<AppEnv>()
  .get("/", canView, zValidator("query", generationListQuerySchema), async (c) => {
    const { sort, order, limit, offset, ...filter } = c.req.valid("query");
    const where = filterWhere(c.get("user"), filter);
    const direction = order === "asc" ? asc : desc;
    // Rows without a value (unfinished, failed) go last both ways. Ascending is Postgres's
    // default, so the per-column index serves it; descending NULLS LAST is a top-N sort instead.
    const column = generation[sort];
    const primary = order === "asc" ? asc(column) : sql`${column} desc nulls last`;
    const [items, [total]] = await Promise.all([
      selectSummaries({})
        .where(where)
        .orderBy(primary, direction(generation.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(generation).where(where),
    ]);
    return c.json({ items, total: total?.count ?? 0 });
  })
  .get("/export.csv", canView, zValidator("query", generationFilterSchema), async (c) => {
    const rows = await selectSummaries({})
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
  .get("/render-times", canView, zValidator("query", generationFilterSchema), async (c) => {
    // The histogram shows where the time range filter sits, so it doesn't apply it.
    const { minTotalMs: _min, maxTotalMs: _max, ...filter } = c.req.valid("query");
    const where = filterWhere(c.get("user"), filter);
    const edges = sql.raw(`array[${RENDER_TIME_EDGES_MS.join(",")}]::int[]`);
    // width_bucket: 0 below the first edge, i for [edge i-1, edge i), edges.length past the last.
    const bucket = sql<number>`width_bucket(${generation.totalMs}, ${edges})`.mapWith(Number);
    const [counts, [stats]] = await Promise.all([
      db
        .select({ bucket, count: count() })
        .from(generation)
        .where(and(where, isNotNull(generation.totalMs)))
        .groupBy(bucket),
      db
        .select({
          timed: count(generation.totalMs),
          percentiles: sql<
            (number | null)[] | null
          >`percentile_disc(array[0.5, 0.95, 0.99]) within group (order by ${generation.totalMs})`,
          failed: sql<number>`count(*) filter (where ${generation.status} = 'error')`.mapWith(
            Number,
          ),
        })
        .from(generation)
        .where(where),
    ]);
    const lows = [0, ...RENDER_TIME_EDGES_MS];
    const [p50Ms = null, p95Ms = null, p99Ms = null] = stats?.percentiles ?? [];
    return c.json({
      buckets: lows.map((minMs, i) => ({
        minMs,
        maxMs: RENDER_TIME_EDGES_MS[i] ?? null,
        count: counts.find((row) => row.bucket === i)?.count ?? 0,
      })),
      timed: stats?.timed ?? 0,
      p50Ms,
      p95Ms,
      p99Ms,
      failed: stats?.failed ?? 0,
    } satisfies RenderTimeHistogram);
  })
  .delete(
    "/",
    requireRole("admin"),
    demo.off,
    zValidator("query", generationFilterSchema),
    async (c) => {
      const filter = c.req.valid("query");
      const where = filterWhere(c.get("user"), filter);
      if (!where) return c.json({ error: "Pick at least one filter to bulk delete" }, 422);
      const deleted = await deleteGenerations(where);
      await recordAudit({
        action: "generation.bulk_deleted",
        target: { id: null, name: `${deleted} generations` },
        details: { filter, deleted },
      });
      return c.json({ deleted }, 200);
    },
  )
  .get("/:id", canView, idParam, async (c) => {
    const [row] = await selectSummaries({
      input: generation.input,
      timings: generation.timings,
      requestId: generation.requestId,
      signing: generation.signing,
      outputProfile: generation.outputProfile,
      subject: generation.subject,
    }).where(visible(c.get("user"), c.req.valid("param").id));
    if (!row) return c.json({ error: "Generation not found" }, 404);
    // Someone else's entry (an admin looking): sensitive values masked (ADR 0039).
    const input =
      row.input && row.userId !== c.get("user").id
        ? await maskedInput(row.input, row.templateVersionId)
        : row.input;
    return c.json({ ...row, input }, 200);
  })
  .get("/:id/pdf", canView, idParam, async (c) => {
    const output = await findOutput(c.get("user"), c.req.valid("param").id);
    if (!output) return c.json({ error: "No PDF for this generation" }, 404);
    // Audit hook (docs/features/audit-log.md): record the download here.
    return serveFile(c, output);
  })
  .post("/:id/link", canView, idParam, zValidator("json", downloadLinkRequestSchema), async (c) => {
    const { id } = c.req.valid("param");
    const output = await findOutput(c.get("user"), id);
    if (!output) return c.json({ error: "No PDF for this generation" }, 404);
    const link = await mintLink({
      fileId: output.fileId,
      generationId: id,
      userId: c.get("user").id,
      expiresInSeconds: c.req.valid("json").expiresInSeconds,
    });
    return c.json(link, 201);
  })
  .get(
    "/:id/signing-package",
    canView,
    idParam,
    zValidator("query", signingPackageQuerySchema),
    async (c) => {
      const [row] = await db
        .select({
          id: generation.id,
          filename: generation.filename,
          pageCount: generation.pageCount,
          fileId: generation.outputFileId,
          signing: generation.signing,
        })
        .from(generation)
        .where(visible(c.get("user"), c.req.valid("param").id));
      if (!row?.fileId) return c.json({ error: "No PDF for this generation" }, 404);
      const options = signingQueryOptions(c.req.valid("query"));
      return c.json(
        await signingResponse({ ...row, fileId: row.fileId }, options, c.get("user").id),
        200,
      );
    },
  )
  .post("/:id/rerun", canView, demo.limit("render"), idParam, async (c) => {
    const actor = c.get("user");
    const [original] = await db
      .select({
        id: generation.id,
        input: generation.input,
        templateId: generation.templateId,
        templateVersionId: generation.templateVersionId,
        subject: generation.subject,
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
      subject: original.subject,
      ...(original.templateId && original.templateVersionId
        ? { template: { id: original.templateId, versionId: original.templateVersionId } }
        : {}),
      wait: true,
    });
    const [rerun] = await selectSummaries({}).where(eq(generation.id, result.generationId));
    return c.json(rerun, 201);
  })
  .delete("/:id", canView, idParam, async (c) => {
    const deleted = await deleteGenerations(visible(c.get("user"), c.req.valid("param").id));
    return deleted ? c.body(null, 204) : c.json({ error: "Generation not found" }, 404);
  });
