import { buffer } from "node:stream/consumers";
import { PDFDocument } from "@cantoo/pdf-lib";
import { zValidator } from "@hono/zod-validator";
import {
  batchJsonSchema,
  batchStatus,
  csvMappingSchema,
  csvToRows,
  defaultCsvMapping,
  fieldErrors,
  MAX_BATCH_ROWS,
  parseCsv,
  parseRoles,
  templateDataSchema,
  versionParamSchema,
} from "@necodoc/shared";
import { and, asc, desc, eq, isNotNull, isNull, max, type SQL, sql } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { batch, generation, user } from "../db/schema";
import { findFile, openFile } from "../files";
import { enqueue, pdfFilename, queuedRow } from "../generate";
import { type AppEnv, requirePermission, type SignedInEnv } from "../middleware";
import { priorities } from "../queue";
import { findVersion, versionRequest } from "./templates";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). Each row is a
// generation with the batch's id; batch rows queue behind interactive renders.

type SignedInUser = SignedInEnv["Variables"]["user"];

const isAdmin = (actor: SignedInUser) => parseRoles(actor.role).includes("admin");
const canView = requirePermission({ document: ["view"] });
const idParam = zValidator("param", z.object({ id: z.uuid() }));
const versionParam = zValidator("param", z.object({ id: z.uuid(), version: versionParamSchema }));

const counted = (status: "success" | "error" | "cancelled") =>
  sql<number>`count(${generation.id}) filter (where ${generation.status} = ${status})`.mapWith(
    Number,
  );

async function batchSummaries(where: SQL | undefined) {
  const rows = await db
    .select({
      id: batch.id,
      templateId: batch.templateId,
      templateVersionId: batch.templateVersionId,
      templateName: batch.templateName,
      version: batch.version,
      userId: batch.userId,
      userName: user.name,
      total: batch.total,
      done: counted("success"),
      failed: counted("error"),
      cancelled: counted("cancelled"),
      createdAt: batch.createdAt,
      cancelledAt: batch.cancelledAt,
      lastFinishedAt: max(generation.finishedAt),
    })
    .from(batch)
    .leftJoin(user, eq(user.id, batch.userId))
    .leftJoin(generation, eq(generation.batchId, batch.id))
    .where(where)
    .groupBy(batch.id, user.name)
    .orderBy(desc(batch.createdAt))
    .limit(200);
  return rows.map(({ lastFinishedAt, ...row }) => {
    const status = batchStatus(row);
    return { ...row, status, finishedAt: status === "running" ? null : lastFinishedAt };
  });
}

/** Matches one batch, if the actor may see it. */
const visible = (actor: SignedInUser, id: string) =>
  isAdmin(actor) ? eq(batch.id, id) : and(eq(batch.id, id), eq(batch.userId, actor.id));

const formatFieldErrors = (errors: Record<string, string[]>) =>
  `Invalid data: ${Object.entries(errors)
    .map(([path, messages]) => `${path || "(row)"}: ${messages.join(", ")}`)
    .join("; ")}`;

/**
 * Validates every row against the version's fields and queues the valid ones. Invalid rows are
 * logged as failed generations with their field errors, so the rest still run.
 */
async function createBatch(
  actor: SignedInUser,
  { id, version }: { id: string; version: "latest" | number },
  { rows, filename }: { rows: Record<string, unknown>[]; filename?: string },
  requestId: string,
) {
  const found = await findVersion(actor, id, version);
  if (!found) return { error: "Version not found", status: 404 } as const;
  if (found.archivedAt) return { error: "This template is archived", status: 409 } as const;
  const v = found.version;
  const schema = templateDataSchema(v.sections);
  const digits = String(rows.length).length;
  const base = filename ?? v.name;
  const now = new Date();
  const batchId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(batch)
      .values({
        userId: actor.id,
        templateId: id,
        templateVersionId: v.id,
        templateName: v.name,
        version: v.version,
        total: rows.length,
        requestId,
      })
      .returning({ id: batch.id });
    if (!created) throw new Error("Batch insert returned no row");
    const generations = rows.map((data, i) => {
      const parsed = schema.safeParse(data);
      const row = {
        ...queuedRow({
          request: versionRequest(
            v,
            parsed.success ? parsed.data : data,
            `${base} ${String(i + 1).padStart(digits, "0")}`,
          ),
          source: "batch",
          userId: actor.id,
          requestId,
          template: { id, versionId: v.id },
        }),
        batchId: created.id,
        batchRow: i + 1,
      };
      return parsed.success
        ? row
        : {
            ...row,
            status: "error" as const,
            error: formatFieldErrors(fieldErrors(parsed.error)),
            finishedAt: now,
            totalMs: 0,
          };
    });
    await enqueue(tx, generations, priorities.batch);
    return created.id;
  });
  const [summary] = await batchSummaries(eq(batch.id, batchId));
  return { summary };
}

const csvFormSchema = z.object({
  file: z.instanceof(File),
  /** JSON: CSV column → field path. Without it, columns named like a field path map themselves. */
  mapping: z
    .string()
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "The column mapping isn't JSON" });
        return z.NEVER;
      }
    })
    .pipe(csvMappingSchema)
    .optional(),
  filename: z.string().trim().min(1).max(200).optional(),
});

/** POST /templates/:id/versions/:version/batch[/csv], mounted beside the template routes. */
export const templateBatchRoutes = new Hono<AppEnv>()
  .post(
    "/:id/versions/:version/batch",
    canView,
    versionParam,
    zValidator("json", batchJsonSchema),
    async (c) => {
      const result = await createBatch(
        c.get("user"),
        c.req.valid("param"),
        c.req.valid("json"),
        c.get("requestId"),
      );
      if ("error" in result) return c.json({ error: result.error }, result.status);
      return c.json(result.summary, 201);
    },
  )
  .post(
    "/:id/versions/:version/batch/csv",
    canView,
    versionParam,
    zValidator("form", csvFormSchema),
    async (c) => {
      const params = c.req.valid("param");
      const form = c.req.valid("form");
      const found = await findVersion(c.get("user"), params.id, params.version);
      if (!found) return c.json({ error: "Version not found" }, 404);
      const csv = parseCsv(await form.file.text());
      const header = csv[0] ?? [];
      const mapping = form.mapping ?? defaultCsvMapping(header, found.version.sections);
      const rows = csvToRows(csv, mapping, found.version.sections);
      if (!rows.length) return c.json({ error: "The CSV has no data rows" }, 422);
      if (rows.length > MAX_BATCH_ROWS) {
        return c.json({ error: `A batch is limited to ${MAX_BATCH_ROWS} rows` }, 422);
      }
      const result = await createBatch(
        c.get("user"),
        params,
        { rows, ...(form.filename ? { filename: form.filename } : {}) },
        c.get("requestId"),
      );
      if ("error" in result) return c.json({ error: result.error }, result.status);
      return c.json(result.summary, 201);
    },
  );

/** A batch's stored PDFs in row order. ZIP and packet are built from them on each download. */
const outputs = (batchId: string) =>
  db
    .select({ fileId: generation.outputFileId, filename: generation.filename })
    .from(generation)
    .where(and(eq(generation.batchId, batchId), isNotNull(generation.outputFileId)))
    .orderBy(asc(generation.batchRow));

const attachment = (name: string) => `attachment; filename="${name.replace(/["\\\r\n]/g, "_")}"`;

export const batchRoutes = new Hono<AppEnv>()
  .get("/", canView, async (c) => {
    const actor = c.get("user");
    return c.json(await batchSummaries(isAdmin(actor) ? undefined : eq(batch.userId, actor.id)));
  })
  .get("/:id", canView, idParam, async (c) => {
    const [summary] = await batchSummaries(visible(c.get("user"), c.req.valid("param").id));
    return summary ? c.json(summary, 200) : c.json({ error: "Batch not found" }, 404);
  })
  .post("/:id/cancel", canView, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const [found] = await db
      .select({ id: batch.id })
      .from(batch)
      .where(visible(c.get("user"), id));
    if (!found) return c.json({ error: "Batch not found" }, 404);
    // Rows already running finish; queued rows never start (the worker skips cancelled rows).
    await db.transaction(async (tx) => {
      await tx
        .update(batch)
        .set({ cancelledAt: new Date() })
        .where(and(eq(batch.id, id), isNull(batch.cancelledAt)));
      await tx
        .update(generation)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(and(eq(generation.batchId, id), eq(generation.status, "queued")));
    });
    const [summary] = await batchSummaries(eq(batch.id, id));
    return c.json(summary, 200);
  })
  .get("/:id/zip", canView, idParam, async (c) => {
    const [found] = await db
      .select({ name: batch.templateName })
      .from(batch)
      .where(visible(c.get("user"), c.req.valid("param").id));
    if (!found) return c.json({ error: "Batch not found" }, 404);
    const rows = await outputs(c.req.valid("param").id);
    // Streams one PDF per pull, so a large batch never sits in memory whole. PDFs are already
    // compressed; entries are stored, not deflated.
    let next = 0;
    let zip: Zip;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        zip = new Zip((error, chunk, final) => {
          if (error) return controller.error(error);
          controller.enqueue(chunk);
          if (final) controller.close();
        });
      },
      async pull() {
        const row = rows[next++];
        if (!row) return zip.end();
        const stored = row.fileId ? await findFile(db, row.fileId) : null;
        if (!stored) return;
        const entry = new ZipPassThrough(row.filename);
        zip.add(entry);
        const chunks: AsyncIterable<Buffer> = await openFile(db, stored);
        for await (const chunk of chunks) entry.push(chunk);
        entry.push(new Uint8Array(0), true);
      },
    });
    return c.body(body, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": attachment(pdfFilename(found.name).replace(/\.pdf$/, ".zip")),
    });
  })
  .get("/:id/packet", canView, idParam, async (c) => {
    const [found] = await db
      .select({ name: batch.templateName })
      .from(batch)
      .where(visible(c.get("user"), c.req.valid("param").id));
    if (!found) return c.json({ error: "Batch not found" }, 404);
    const packet = await PDFDocument.create();
    for (const row of await outputs(c.req.valid("param").id)) {
      const stored = row.fileId ? await findFile(db, row.fileId) : null;
      if (!stored) continue;
      const source = await PDFDocument.load(await buffer(await openFile(db, stored)));
      for (const page of await packet.copyPages(source, source.getPageIndices())) {
        packet.addPage(page);
      }
    }
    if (!packet.getPageCount()) return c.json({ error: "This batch has no PDFs yet" }, 404);
    return c.body(new Uint8Array(await packet.save()), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(pdfFilename(`${found.name} packet`)),
    });
  });
