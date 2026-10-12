import { zValidator } from "@hono/zod-validator";
import {
  createSubmissionSchema,
  fieldAnswers,
  fieldErrors,
  finishSubmissionSchema,
  type GenerationSource,
  submissionListQuerySchema,
  templateDataSchema,
  updateSubmissionSchema,
} from "@necodoc/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { generation, shareLink, submission, templateVersion } from "../db/schema";
import { serveFile } from "../download";
import { generate } from "../generate";
import { type AppEnv, demo, requirePermission } from "../middleware";
import { findVersion, versionRequest } from "./templates";

// Spec: docs/features/filling-out-a-document.md. Documents are private to their owner, admins
// included. Share-link submissions (routes/share-links.ts) belong to the link's owner.

const canView = requirePermission({ document: ["view"] });
const idParam = zValidator("param", z.object({ id: z.uuid() }));

const LIST_LIMIT = 1000;

const own = (ownerId: string, id: string) =>
  and(eq(submission.id, id), eq(submission.ownerId, ownerId));

const summaryColumns = {
  id: submission.id,
  name: submission.name,
  status: submission.status,
  source: submission.source,
  templateId: submission.templateId,
  templateVersionId: submission.templateVersionId,
  templateName: templateVersion.name,
  kind: templateVersion.kind,
  version: templateVersion.version,
  shareLinkId: submission.shareLinkId,
  shareLinkLabel: shareLink.label,
  respondentEmail: submission.respondentEmail,
  generationId: submission.generationId,
  generationStatus: generation.status,
  generationError: generation.error,
  pageCount: generation.pageCount,
  finishedAt: submission.finishedAt,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
};

/** Documents with their version, current generation and share link, newest edit first. */
export const selectSubmissions = () =>
  db
    .select(summaryColumns)
    .from(submission)
    .innerJoin(templateVersion, eq(templateVersion.id, submission.templateVersionId))
    .leftJoin(generation, eq(generation.id, submission.generationId))
    .leftJoin(shareLink, eq(shareLink.id, submission.shareLinkId))
    .orderBy(desc(submission.updatedAt))
    .$dynamic();

async function findOwn(ownerId: string, id: string) {
  const [row] = await db
    .select({ submission, version: templateVersion })
    .from(submission)
    .innerJoin(templateVersion, eq(templateVersion.id, submission.templateVersionId))
    .where(own(ownerId, id));
  return row ?? null;
}

type Submission = typeof submission.$inferSelect;
type Version = typeof templateVersion.$inferSelect;

/**
 * A version's language and translations, for the fill form's language picker and labels
 * (docs/features/document-localization.md). Content saved before localization has neither.
 */
export const versionLocalization = ({ content }: Version) => ({
  lang: content.output?.lang ?? "en",
  translations: content.translations ?? {},
});

/**
 * Validates the stored answers strictly and queues the PDF from the pinned version; the document
 * points at the new generation. `wait` holds on for the worker like a synchronous generate.
 */
export async function finishSubmission({
  row,
  version,
  source,
  requestId,
  wait,
}: {
  row: Submission;
  version: Version;
  source: Extract<GenerationSource, "app" | "share_link">;
  requestId: string;
  wait: boolean;
}) {
  const parsed = templateDataSchema(version.sections).safeParse(row.data);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) } as const;
  const result = await generate({
    request: versionRequest(
      version,
      parsed.data,
      row.name,
      row.locale ? { lang: row.locale } : undefined,
    ),
    source,
    userId: row.ownerId,
    requestId,
    template: { id: version.templateId, versionId: version.id },
    // A share-link respondent is who the document is about.
    subject: row.respondentEmail,
    wait,
  });
  await db
    .update(submission)
    .set({ status: "finished", finishedAt: new Date(), generationId: result.generationId })
    .where(eq(submission.id, row.id));
  return { ok: true, result } as const;
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
