import { zValidator } from "@hono/zod-validator";
import {
  batchJsonSchema,
  csvMappingSchema,
  csvToRows,
  defaultCsvMapping,
  MAX_BATCH_ROWS,
  parseCsv,
  versionParamSchema,
} from "@necodoc/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { batchPacket, batchSummaries, batchZip, createBatch } from "../batches";
import { db } from "../db";
import { batch, generation } from "../db/schema";
import { type AppEnv, canView, demo, idParam, isAdmin, type SignedInEnv } from "../middleware";
import { findVersion } from "../templates";
import { completeBatch } from "../webhooks";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). Each row is a
// generation with the batch's id; batch rows queue behind interactive renders.

type SignedInUser = SignedInEnv["Variables"]["user"];

const versionParam = zValidator("param", z.object({ id: z.uuid(), version: versionParamSchema }));

/** Matches one batch, if the actor may see it. */
const visible = (actor: SignedInUser, id: string) =>
  isAdmin(actor) ? eq(batch.id, id) : and(eq(batch.id, id), eq(batch.userId, actor.id));

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
    demo.limit("batch"),
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
    demo.limit("batch"),
    versionParam,
    zValidator("form", csvFormSchema),
    async (c) => {
      const params = c.req.valid("param");
      const form = c.req.valid("form");
      const found = await findVersion(c.get("user"), params.id, params.version);
      if (!found) return c.json({ error: "Template version not found" }, 404);
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
      .select({ id: batch.id, name: batch.templateName })
      .from(batch)
      .where(visible(c.get("user"), id));
    if (!found) return c.json({ error: "Batch not found" }, 404);
    // Rows already running finish; queued rows never start (the worker skips cancelled rows).
    await db.transaction(async (tx) => {
      await recordAudit({ action: "batch.cancelled", target: { id, name: found.name } }, tx);
      const cancelled = await tx
        .update(generation)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(and(eq(generation.batchId, id), eq(generation.status, "queued")))
        .returning({ id: generation.id });
      // A batch whose rows all finished meanwhile stays completed.
      if (cancelled.length > 0)
        await tx
          .update(batch)
          .set({ cancelledAt: new Date() })
          .where(and(eq(batch.id, id), isNull(batch.cancelledAt)));
    });
    await completeBatch(id);
    const [summary] = await batchSummaries(eq(batch.id, id));
    return c.json(summary, 200);
  })
  .get("/:id/zip", canView, idParam, async (c) => {
    const [found] = await db
      .select({ id: batch.id, name: batch.templateName })
      .from(batch)
      .where(visible(c.get("user"), c.req.valid("param").id));
    return found ? batchZip(c, found) : c.json({ error: "Batch not found" }, 404);
  })
  .get("/:id/packet", canView, idParam, async (c) => {
    const [found] = await db
      .select({ id: batch.id, name: batch.templateName })
      .from(batch)
      .where(visible(c.get("user"), c.req.valid("param").id));
    return found ? batchPacket(c, found) : c.json({ error: "Batch not found" }, 404);
  });
