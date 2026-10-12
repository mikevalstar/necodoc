import { zValidator } from "@hono/zod-validator";
import { type DetectionStatus, detectionResultSchema, detectRequestSchema } from "@necodoc/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAi } from "../ai";
import { db } from "../db";
import { file, pdfSource } from "../db/schema";
import { FileTooLargeError, fileBytes, storeFile } from "../files";
import { type AppEnv, demo, requireAnyPermission, requirePermission } from "../middleware";
import { boss, type DetectJobData, queues } from "../queue";
import { inspectUpload, PdfUploadError } from "../render/pdf-source";
import { fileHeaders } from "./http";

// Spec: docs/features/pdf-overlay-templates.md (upload, AI auto-detect). An upload is checked and
// read once (ADR 0028), kept in Postgres (ADR 0014), and referenced by overlay templates.

const idParam = zValidator("param", z.object({ id: z.uuid() }));
const canUpload = requireAnyPermission({ document: ["create"] }, { document: ["edit"] });
const canSeeDrafts = requireAnyPermission(
  { document: ["edit"] },
  { document: ["review"] },
  { document: ["publish"] },
);
const canEdit = requirePermission({ document: ["edit"] });

const columns = {
  id: pdfSource.id,
  filename: pdfSource.filename,
  size: file.size,
  pages: pdfSource.pages,
  fields: pdfSource.fields,
  encrypted: pdfSource.encrypted,
  xfa: pdfSource.xfa,
  createdAt: pdfSource.createdAt,
};

async function findSource(id: string) {
  const [row] = await db
    .select({ ...columns, fileId: pdfSource.fileId })
    .from(pdfSource)
    .innerJoin(file, eq(file.id, pdfSource.fileId))
    .where(eq(pdfSource.id, id));
  return row ?? null;
}

const failedOutput = z.object({ message: z.string() });

export const pdfSourceRoutes = new Hono<AppEnv>()
  .post(
    "/",
    canUpload,
    demo.limit("upload"),
    zValidator("form", z.object({ file: z.instanceof(File) })),
    async (c) => {
      const upload = c.req.valid("form").file;
      const bytes = new Uint8Array(await upload.arrayBuffer());
      let inspected: Awaited<ReturnType<typeof inspectUpload>>;
      try {
        inspected = await inspectUpload(bytes);
      } catch (error) {
        if (error instanceof PdfUploadError) return c.json({ error: error.message }, 422);
        throw error;
      }
      const userId = c.get("user").id;
      try {
        const id = await db.transaction(async (tx) => {
          const fileId = await storeFile(tx, {
            bytes,
            mimeType: "application/pdf",
            ownerId: userId,
          });
          const [row] = await tx
            .insert(pdfSource)
            .values({
              ...inspected,
              fileId,
              filename: upload.name || "document.pdf",
              uploadedBy: userId,
            })
            .returning({ id: pdfSource.id });
          return row?.id;
        });
        const created = id ? await findSource(id) : null;
        if (!created) throw new Error("PDF source insert returned no row");
        const { fileId: _f, ...summary } = created;
        return c.json(summary, 201);
      } catch (error) {
        if (error instanceof FileTooLargeError) return c.json({ error: error.message }, 413);
        throw error;
      }
    },
  )
  .get("/:id", canSeeDrafts, idParam, async (c) => {
    const found = await findSource(c.req.valid("param").id);
    if (!found) return c.json({ error: "PDF not found" }, 404);
    const { fileId: _f, ...summary } = found;
    return c.json(summary, 200);
  })
  .get("/:id/pdf", canSeeDrafts, idParam, async (c) => {
    const found = await findSource(c.req.valid("param").id);
    const stored = found && (await fileBytes(db, found.fileId));
    if (!stored) return c.json({ error: "PDF not found" }, 404);
    return c.body(stored.bytes, 200, fileHeaders("application/pdf"));
  })
  .post(
    "/:id/detect",
    requireAi,
    canEdit,
    idParam,
    zValidator("json", detectRequestSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      if (!(await findSource(id))) return c.json({ error: "PDF not found" }, 404);
      const data: DetectJobData = {
        sourceId: id,
        userId: c.get("user").id,
        known: c.req.valid("json").fields,
      };
      const jobId = await boss.send(queues.detectFields, data);
      if (!jobId) throw new Error("The detection job wasn't queued");
      return c.json({ jobId }, 202);
    },
  )
  .get(
    "/:id/detect/:jobId",
    requireAi,
    canEdit,
    zValidator("param", z.object({ id: z.uuid(), jobId: z.uuid() })),
    async (c) => {
      const { id, jobId } = c.req.valid("param");
      const job = await boss.getJobById<DetectJobData>(queues.detectFields, jobId);
      if (!job || job.data.sourceId !== id || job.data.userId !== c.get("user").id) {
        return c.json({ error: "Detection not found" }, 404);
      }
      let status: DetectionStatus;
      if (job.state === "completed") {
        const result = detectionResultSchema.safeParse(job.output);
        status = result.success
          ? { status: "done", result: result.data }
          : { status: "failed", error: "The detection result was unreadable" };
      } else if (job.state === "failed" || job.state === "cancelled") {
        const output = failedOutput.safeParse(job.output);
        status = {
          status: "failed",
          error: output.success ? output.data.message : `The detection was ${job.state}`,
        };
      } else {
        status = { status: "pending" };
      }
      return c.json(status, 200);
    },
  );
