import { buffer } from "node:stream/consumers";
import { PDFDocument } from "@cantoo/pdf-lib";
import { batchStatus, fieldErrors, templateDataSchema } from "@necodoc/shared";
import { and, asc, desc, eq, isNotNull, max, type SQL, sql } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";
import type { Context } from "hono";
import { recordAudit } from "./audit";
import { db } from "./db";
import { batch, generation, user } from "./db/schema";
import { env } from "./env";
import { findFile, openFile } from "./files";
import { enqueue, pdfFilename, queuedRow } from "./generate";
import type { SignedInEnv } from "./middleware";
import { priorities } from "./queue";
import { findVersion, versionRequest } from "./templates";
import { completeBatch } from "./webhooks";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). Each row is a
// generation with the batch's id; batch rows queue behind interactive renders. Shared by the app's
// batch routes and /api/v1.

type SignedInUser = SignedInEnv["Variables"]["user"];

const counted = (status: "success" | "error" | "cancelled") =>
  sql<number>`count(${generation.id}) filter (where ${generation.status} = ${status})`.mapWith(
    Number,
  );

export async function batchSummaries(where: SQL | undefined) {
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

const formatFieldErrors = (errors: Record<string, string[]>) =>
  `Invalid data: ${Object.entries(errors)
    .map(([path, messages]) => `${path || "(row)"}: ${messages.join(", ")}`)
    .join("; ")}`;

/**
 * Validates every row against the version's fields and queues the valid ones. Invalid rows are
 * logged as failed generations with their field errors, so the rest still run. `apiKeyId` marks
 * batches started through /api/v1.
 */
export async function createBatch(
  actor: SignedInUser,
  { id, version }: { id: string; version: "latest" | number },
  { rows, filename }: { rows: Record<string, unknown>[]; filename?: string },
  requestId: string,
  apiKeyId?: string,
) {
  // ADR 0046: the public demo takes small batches only.
  if (env.DEMO_MODE && rows.length > env.DEMO_BATCH_MAX_ROWS) {
    return {
      error: `The public demo limits a batch to ${env.DEMO_BATCH_MAX_ROWS} rows`,
      status: 422,
    } as const;
  }
  const found = await findVersion(actor, id, version);
  if (!found) return { error: "Template version not found", status: 404 } as const;
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
        apiKeyId,
      })
      .returning({ id: batch.id });
    if (!created) throw new Error("Batch insert returned no row");
    await recordAudit(
      {
        action: "batch.started",
        target: { id: created.id, name: v.name },
        details: { templateId: id, version: v.version, rows: rows.length },
      },
      tx,
    );
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
          apiKeyId,
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
  // A batch whose every row was invalid has nothing left to run.
  await completeBatch(batchId);
  const [summary] = await batchSummaries(eq(batch.id, batchId));
  return { summary };
}

/** A batch's stored PDFs in row order. ZIP and packet are built from them on each download. */
const outputs = (batchId: string) =>
  db
    .select({ fileId: generation.outputFileId, filename: generation.filename })
    .from(generation)
    .where(and(eq(generation.batchId, batchId), isNotNull(generation.outputFileId)))
    .orderBy(asc(generation.batchRow));

const attachment = (name: string) => `attachment; filename="${name.replace(/["\\\r\n]/g, "_")}"`;

/**
 * Streams a batch's PDFs as a ZIP, one PDF per pull, so a large batch never sits in memory whole.
 * PDFs are already compressed; entries are stored, not deflated. The caller checks access.
 */
export async function batchZip(c: Context, found: { id: string; name: string }) {
  const rows = await outputs(found.id);
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
}

/** Merges a batch's PDFs into one packet, in memory. The caller checks access. */
export async function batchPacket(c: Context, found: { id: string; name: string }) {
  const packet = await PDFDocument.create();
  for (const row of await outputs(found.id)) {
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
}
