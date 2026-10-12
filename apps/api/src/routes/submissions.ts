import { zValidator } from "@hono/zod-validator";
import {
  createSubmissionSchema,
  fieldAnswers,
  finishSubmissionSchema,
  submissionListQuerySchema,
  updateSubmissionSchema,
} from "@necodoc/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { generation, submission, templateVersion } from "../db/schema";
import { serveFile } from "../download";
import { type AppEnv, canView, demo, idParam } from "../middleware";
import { finishSubmission, selectSubmissions, versionLocalization } from "../submissions";
import { findVersion } from "../templates";

// Spec: docs/features/filling-out-a-document.md. Documents are private to their owner, admins
// included. Share-link submissions (routes/share-links.ts) belong to the link's owner.

const LIST_LIMIT = 1000;

const own = (ownerId: string, id: string) =>
  and(eq(submission.id, id), eq(submission.ownerId, ownerId));

async function findOwn(ownerId: string, id: string) {
  const [row] = await db
    .select({ submission, version: templateVersion })
    .from(submission)
    .innerJoin(templateVersion, eq(templateVersion.id, submission.templateVersionId))
    .where(own(ownerId, id));
  return row ?? null;
}

export const submissionRoutes = new Hono<AppEnv>()
  .get("/", canView, zValidator("query", submissionListQuerySchema), async (c) => {
    const { status, source, shareLinkId } = c.req.valid("query");
    const rows = await selectSubmissions()
      .where(
        and(
          eq(submission.ownerId, c.get("user").id),
          status ? eq(submission.status, status) : undefined,
          source ? eq(submission.source, source) : undefined,
          shareLinkId ? eq(submission.shareLinkId, shareLinkId) : undefined,
        ),
      )
      .limit(LIST_LIMIT);
    return c.json(rows, 200);
  })
  .post("/", canView, zValidator("json", createSubmissionSchema), async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("user");
    const found = await findVersion(actor, body.templateId, body.version ?? "latest");
    if (!found) return c.json({ error: "Template version not found" }, 404);
    if (found.archivedAt) return c.json({ error: "This template is archived" }, 409);
    let data: Record<string, unknown> = {};
    if (body.fromSubmissionId) {
      const [from] = await db
        .select({ data: submission.data })
        .from(submission)
        .where(own(actor.id, body.fromSubmissionId));
      if (!from) return c.json({ error: "The document to start from wasn't found" }, 404);
      data = fieldAnswers(found.version.sections, from.data);
    }
    const [row] = await db
      .insert(submission)
      .values({
        ownerId: actor.id,
        templateId: body.templateId,
        templateVersionId: found.version.id,
        name: body.name ?? found.version.name,
        data,
      })
      .returning({ id: submission.id });
    return c.json(row, 201);
  })
  .get("/:id", canView, idParam, async (c) => {
    const actor = c.get("user");
    const { id } = c.req.valid("param");
    const [[summary], found] = await Promise.all([
      selectSubmissions().where(own(actor.id, id)),
      findOwn(actor.id, id),
    ]);
    if (!summary || !found) return c.json({ error: "Document not found" }, 404);
    const { data, step, locale } = found.submission;
    const { sections, description } = found.version;
    return c.json(
      {
        ...summary,
        data,
        step,
        sections,
        description,
        locale,
        ...versionLocalization(found.version),
      },
      200,
    );
  })
  .patch("/:id", canView, idParam, zValidator("json", updateSubmissionSchema), async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const found = await findOwn(c.get("user").id, id);
    if (!found) return c.json({ error: "Document not found" }, 404);
    // Lenient while drafting: only the shape is checked, and unknown keys are dropped.
    const changes = body.data
      ? { ...body, data: fieldAnswers(found.version.sections, body.data), status: "draft" as const }
      : body;
    const [row] = await db
      .update(submission)
      .set(changes)
      .where(eq(submission.id, id))
      .returning({ updatedAt: submission.updatedAt, status: submission.status });
    return c.json(row, 200);
  })
  .delete("/:id", canView, idParam, async (c) => {
    // Its generations stay in the log; the document only pointed at them.
    const [deleted] = await db
      .delete(submission)
      .where(own(c.get("user").id, c.req.valid("param").id))
      .returning({ id: submission.id });
    return deleted ? c.body(null, 204) : c.json({ error: "Document not found" }, 404);
  })
  .post(
    "/:id/finish",
    canView,
    demo.limit("render"),
    idParam,
    zValidator("json", finishSubmissionSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const found = await findOwn(c.get("user").id, id);
      if (!found) return c.json({ error: "Document not found" }, 404);
      const row = body.data
        ? { ...found.submission, data: fieldAnswers(found.version.sections, body.data) }
        : found.submission;
      if (body.data)
        await db.update(submission).set({ data: row.data }).where(eq(submission.id, id));
      // Also how a finished document is regenerated. Answers at once; the app polls the document.
      const finished = await finishSubmission({
        row,
        version: found.version,
        source: "app",
        requestId: c.get("requestId"),
        wait: false,
      });
      if (!finished.ok) {
        return c.json(
          { error: "Some answers need fixing", fieldErrors: finished.fieldErrors },
          422,
        );
      }
      return c.json({ generationId: finished.result.generationId }, 202);
    },
  )
  .get("/:id/pdf", canView, idParam, async (c) => {
    const [row] = await db
      .select({ fileId: generation.outputFileId, filename: generation.filename })
      .from(submission)
      .innerJoin(generation, eq(generation.id, submission.generationId))
      .where(own(c.get("user").id, c.req.valid("param").id));
    if (!row?.fileId) return c.json({ error: "This document has no PDF yet" }, 404);
    return serveFile(c, { fileId: row.fileId, filename: row.filename });
  });
