import { zValidator } from "@hono/zod-validator";
import {
  createTemplateSchema,
  defaultOutputOptions,
  fieldErrors,
  generateFromTemplateSchema,
  hasPermission,
  type OutputOverrides,
  type Permissions,
  pageOptionsSchema,
  parseRoles,
  previewTemplateSchema,
  publishTemplateSchema,
  type RenderInput,
  templateDataSchema,
  templateDiff,
  templateJsonSchema,
  updateTemplateSchema,
  versionParamSchema,
} from "@necodoc/shared";
import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { pdfSource, template, templateTestCase, templateVersion, theme, user } from "../db/schema";
import { generate, renderPreview } from "../generate";
import {
  type AppEnv,
  requireAnyPermission,
  requirePermission,
  type SignedInEnv,
} from "../middleware";
import {
  diffableDraft,
  diffableVersion,
  draftRenderInput,
  publishSnapshot,
  savedDraft,
} from "../publish";
import { approvedReview, closeReviewAsPublished, publishingSettings } from "../review";
import { runTests } from "../template-tests";
import { generationResponse, pdfHeaders } from "./http";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md,
// docs/features/template-fields-and-guided-form.md. Drafts are for editors, reviewers and
// publishers; everyone with `document: view` sees and fills published, non-archived versions.

type SignedInUser = SignedInEnv["Variables"]["user"];

export const draftAccess: Permissions[] = [
  { document: ["edit"] },
  { document: ["review"] },
  { document: ["publish"] },
];
const seesDrafts = (actor: SignedInUser) =>
  draftAccess.some((permissions) => hasPermission(parseRoles(actor.role), permissions));

const canView = requirePermission({ document: ["view"] });
const canSeeDrafts = requireAnyPermission(...draftAccess);
const canCreate = requirePermission({ document: ["create"] });
const canEdit = requirePermission({ document: ["edit"] });
const canPublish = requirePermission({ document: ["publish"] });

const idParam = zValidator("param", z.object({ id: z.uuid() }));
const versionParam = zValidator("param", z.object({ id: z.uuid(), version: versionParamSchema }));

export const latest = db
  .select({
    templateId: templateVersion.templateId,
    version: max(templateVersion.version).as("latest_version"),
  })
  .from(templateVersion)
  .groupBy(templateVersion.templateId)
  .as("latest");

export async function findDraft(id: string) {
  const [row] = await db.select().from(template).where(eq(template.id, id));
  return row ?? null;
}

/** A version the actor may see: archived templates are hidden from non-draft users. */
export async function findVersion(actor: SignedInUser, id: string, version: "latest" | number) {
  const number =
    version === "latest"
      ? sql`(select max(${templateVersion.version}) from ${templateVersion} where ${templateVersion.templateId} = ${id})`
      : version;
  const [row] = await db
    .select({ version: templateVersion, archivedAt: template.archivedAt, publisherName: user.name })
    .from(templateVersion)
    .innerJoin(template, eq(template.id, templateVersion.templateId))
    .leftJoin(user, eq(user.id, templateVersion.publishedBy))
    .where(and(eq(templateVersion.templateId, id), eq(templateVersion.version, number)));
  if (!row || (row.archivedAt && !seesDrafts(actor))) return null;
  return row;
}

async function themeError(themeId: string | null | undefined) {
  if (!themeId) return null;
  const [row] = await db.select({ id: theme.id }).from(theme).where(eq(theme.id, themeId));
  return row ? null : `Theme ${themeId} doesn't exist`;
}

async function sourceError(content: { sourceId: string } | undefined) {
  if (!content) return null;
  const [row] = await db
    .select({ id: pdfSource.id })
    .from(pdfSource)
    .where(eq(pdfSource.id, content.sourceId));
  return row ? null : "The template's PDF doesn't exist; upload it again";
}

const versionSummaryColumns = {
  id: templateVersion.id,
  templateId: templateVersion.templateId,
  version: templateVersion.version,
  note: templateVersion.note,
  publishedBy: templateVersion.publishedBy,
  publisherName: user.name,
  publishedAt: templateVersion.publishedAt,
};

export const templateRoutes = new Hono<AppEnv>()
  .get("/", canView, async (c) => {
    const drafts = seesDrafts(c.get("user"));
    const rows = await db
      .select({ draft: template, latest: templateVersion })
      .from(template)
      .leftJoin(latest, eq(latest.templateId, template.id))
      .leftJoin(
        templateVersion,
        and(
          eq(templateVersion.templateId, template.id),
          eq(templateVersion.version, latest.version),
        ),
      )
      .where(drafts ? undefined : and(isNotNull(latest.version), isNull(template.archivedAt)))
      .orderBy(template.name);
    return c.json(
      rows.map(({ draft, latest }) => ({
        id: draft.id,
        kind: draft.kind,
        // Viewers see what's published, not unpublished renames.
        name: drafts || !latest ? draft.name : latest.name,
        description: drafts || !latest ? draft.description : latest.description,
        latestVersion: latest?.version ?? null,
        publishedAt: latest?.publishedAt ?? null,
        hasUnpublishedChanges: !latest || draft.updatedAt > latest.publishedAt,
        /** What filling it uses: pickers show this, not the draft's copy, to editors too. */
        published: latest ? { name: latest.name, description: latest.description } : null,
        archivedAt: draft.archivedAt,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })),
    );
  })
  .post("/", canCreate, zValidator("json", createTemplateSchema), async (c) => {
    const body = c.req.valid("json");
    const error =
      body.kind === "overlay" ? await sourceError(body.content) : await themeError(body.themeId);
    if (error) return c.json({ error }, 422);
    const values =
      body.kind === "overlay"
        ? { ...body, themeId: null, page: pageOptionsSchema.parse({}) }
        : body;
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(template)
        .values({ ...values, createdBy: c.get("user").id })
        .returning();
      if (created) {
        await recordAudit(
          {
            action: "template.created",
            target: { id: created.id, name: created.name },
            after: created,
          },
          tx,
        );
      }
      return created;
    });
    return c.json(row, 201);
  })
  .get("/:id", canSeeDrafts, idParam, async (c) => {
    const row = await findDraft(c.req.valid("param").id);
    return row ? c.json(row, 200) : c.json({ error: "Template not found" }, 404);
  })
  .patch("/:id", canEdit, idParam, zValidator("json", updateTemplateSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { baseUpdatedAt, ...changes } = c.req.valid("json");
    const existing = await findDraft(id);
    if (!existing) return c.json({ error: "Template not found" }, 404);
    if (baseUpdatedAt && existing.updatedAt.getTime() !== Date.parse(baseUpdatedAt)) {
      return c.json(
        { error: "Someone saved this draft since you opened it", updatedAt: existing.updatedAt },
        409,
      );
    }
    const content = changes.content;
    const overlay = content && "sourceId" in content ? content : undefined;
    if (content && Boolean(overlay) !== (existing.kind === "overlay")) {
      return c.json(
        { error: `This is a ${existing.kind} template; send ${existing.kind} content` },
        422,
      );
    }
    const error = (await themeError(changes.themeId)) ?? (await sourceError(overlay));
    if (error) return c.json({ error }, 422);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(template)
        .set(changes)
        .where(eq(template.id, id))
        .returning();
      await recordAudit(
        {
          action: "template.updated",
          target: { id, name: updated?.name ?? existing.name },
          before: existing,
          after: updated,
        },
        tx,
      );
      return updated;
    });
    return c.json(row, 200);
  })
  .delete("/:id", canEdit, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const [published] = await db
      .select({ id: templateVersion.id })
      .from(templateVersion)
      .where(eq(templateVersion.templateId, id))
      .limit(1);
    if (published) {
      return c.json({ error: "Published templates can't be deleted; archive it instead" }, 409);
    }
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx.delete(template).where(eq(template.id, id)).returning();
      if (row) {
        await recordAudit(
          { action: "template.deleted", target: { id, name: row.name }, before: row },
          tx,
        );
      }
      return row;
    });
    return deleted ? c.body(null, 204) : c.json({ error: "Template not found" }, 404);
  })
  .post("/:id/duplicate", canCreate, idParam, async (c) => {
    const existing = await findDraft(c.req.valid("param").id);
    if (!existing) return c.json({ error: "Template not found" }, 404);
    const { id: _id, createdAt: _c, updatedAt: _u, archivedAt: _a, ...draft } = existing;
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(template)
        .values({ ...draft, name: `${draft.name} (copy)`, createdBy: c.get("user").id })
        .returning();
      if (created) {
        await recordAudit(
          {
            action: "template.duplicated",
            target: { id: created.id, name: created.name },
            details: { from: existing.id, fromName: existing.name },
          },
          tx,
        );
      }
      return created;
    });
    return c.json(row, 201);
  })
  .post("/:id/archive", canPublish, idParam, async (c) => {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(template)
        .set({ archivedAt: new Date(), updatedAt: sql`${template.updatedAt}` })
        .where(eq(template.id, c.req.valid("param").id))
        .returning();
      if (updated) {
        await recordAudit(
          { action: "template.archived", target: { id: updated.id, name: updated.name } },
          tx,
        );
      }
      return updated;
    });
    return row ? c.json(row, 200) : c.json({ error: "Template not found" }, 404);
  })
  .post("/:id/restore", canPublish, idParam, async (c) => {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(template)
        .set({ archivedAt: null, updatedAt: sql`${template.updatedAt}` })
        .where(eq(template.id, c.req.valid("param").id))
        .returning();
      if (updated) {
        await recordAudit(
          { action: "template.restored", target: { id: updated.id, name: updated.name } },
          tx,
        );
      }
      return updated;
    });
    return row ? c.json(row, 200) : c.json({ error: "Template not found" }, 404);
  })
  .post(
    "/:id/preview",
    canSeeDrafts,
    idParam,
    zValidator("json", previewTemplateSchema),
    async (c) => {
      const body = c.req.valid("json");
      const saved = await findDraft(c.req.valid("param").id);
      if (!saved) return c.json({ error: "Template not found" }, 404);
      const draft = body.draft ?? savedDraft(saved);
      if (!draft) return c.json({ error: "The saved draft's content doesn't match its kind" }, 422);
      const built = draftRenderInput(draft, body.data ?? draft.sampleData, saved.name);
      if (!built.input) return c.json({ error: built.error }, 422);
      const { input, dataValid } = built;
      const result = await renderPreview(input);
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.body(result.pdf, 200, {
        ...pdfHeaders(result.filename),
        "X-Page-Count": String(result.pageCount),
        "X-Data-Valid": String(dataValid),
        // Overlay warnings (text cut, unknown form fields), URI-encoded JSON.
        "X-Render-Warnings": encodeURIComponent(JSON.stringify(result.warnings.slice(0, 20))),
      });
    },
  )
  .post(
    "/:id/publish",
    canPublish,
    idParam,
    zValidator("json", publishTemplateSchema),
    async (c) => {
      const draft = await findDraft(c.req.valid("param").id);
      if (!draft) return c.json({ error: "Template not found" }, 404);
      const built = await publishSnapshot(draft);
      if (!built.snapshot) return c.json({ error: built.error }, 422);
      const actor = c.get("user");
      const settings = await publishingSettings();
      const review = await approvedReview(draft.id, built.fingerprint);
      if (settings.requireReview && !review) {
        return c.json(
          {
            error:
              "Publishing needs an approved review of this exact draft. Submit it for review, or resubmit if it changed since approval.",
          },
          409,
        );
      }
      if (settings.blockOnFailingTests) {
        const cases = await db
          .select()
          .from(templateTestCase)
          .where(eq(templateTestCase.templateId, draft.id));
        const failed = (await runTests(built.draft, draft.name, cases)).filter((r) => !r.passed);
        if (failed.length) {
          return c.json(
            { error: `Tests failing: ${failed.map((r) => r.name).join(", ")}. Fix them first.` },
            409,
          );
        }
      }
      const templateId = draft.id;
      const note = c.req.valid("json").note || null;
      const row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ version: max(templateVersion.version) })
          .from(templateVersion)
          .where(eq(templateVersion.templateId, templateId));
        const version = (current?.version ?? 0) + 1;
        const [inserted] = await tx
          .insert(templateVersion)
          .values({ ...built.snapshot, templateId, version, note, publishedBy: actor.id })
          .returning({ id: templateVersion.id });
        if (inserted) {
          const closed = await closeReviewAsPublished(tx, {
            templateId,
            fingerprint: built.fingerprint,
            actorId: actor.id,
            version,
            versionId: inserted.id,
          });
          await recordAudit(
            {
              action: "template.published",
              target: { id: templateId, name: built.snapshot.name },
              details: { version, versionId: inserted.id, note, reviewId: closed?.id ?? null },
            },
            tx,
          );
        }
        return inserted;
      });
      const [summary] = row
        ? await selectVersionSummaries().where(eq(templateVersion.id, row.id))
        : [];
      return c.json(summary, 201);
    },
  )
  // Structural diff of the saved draft against the latest version (null before the first).
  .get("/:id/diff", canSeeDrafts, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const draft = await findDraft(id);
    if (!draft) return c.json({ error: "Template not found" }, 404);
    const after = await diffableDraft(draft);
    if (!after) return c.json({ error: "The draft's content doesn't match its kind" }, 422);
    const latestRow = await findVersion(c.get("user"), id, "latest");
    const before = latestRow && diffableVersion(latestRow.version);
    return c.json(
      {
        baseVersion: latestRow?.version.version ?? null,
        diff: before ? templateDiff(before, after) : null,
      },
      200,
    );
  })
  .get("/:id/versions", canView, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const draft = await findDraft(id);
    if (!draft || (draft.archivedAt && !seesDrafts(c.get("user")))) {
      return c.json({ error: "Template not found" }, 404);
    }
    const rows = await selectVersionSummaries()
      .where(eq(templateVersion.templateId, id))
      .orderBy(desc(templateVersion.version));
    return c.json(rows, 200);
  })
  .get("/:id/versions/:version", canView, versionParam, async (c) => {
    const { id, version } = c.req.valid("param");
    const row = await findVersion(c.get("user"), id, version);
    if (!row) return c.json({ error: "Version not found" }, 404);
    const { compiled: _compiled, ...rest } = row.version;
    return c.json({ ...rest, publisherName: row.publisherName }, 200);
  })
  // The change note is history, not content: publishers can write or fix it later (the AI
  // summary can draft it). The audit log keeps the old text.
  .patch(
    "/:id/versions/:version/note",
    canPublish,
    versionParam,
    zValidator("json", publishTemplateSchema),
    async (c) => {
      const { id, version } = c.req.valid("param");
      const row = await findVersion(c.get("user"), id, version);
      if (!row) return c.json({ error: "Version not found" }, 404);
      const note = c.req.valid("json").note || null;
      await db.transaction(async (tx) => {
        await tx
          .update(templateVersion)
          .set({ note })
          .where(eq(templateVersion.id, row.version.id));
        await recordAudit(
          {
            action: "template.version_note_updated",
            target: { id, name: row.version.name },
            before: { note: row.version.note },
            after: { note },
            details: { version: row.version.version },
          },
          tx,
        );
      });
      const [summary] = await selectVersionSummaries().where(
        eq(templateVersion.id, row.version.id),
      );
      return c.json(summary, 200);
    },
  )
  .get("/:id/versions/:version/schema", canView, versionParam, async (c) => {
    const { id, version } = c.req.valid("param");
    const row = await findVersion(c.get("user"), id, version);
    if (!row) return c.json({ error: "Version not found" }, 404);
    return c.json(templateJsonSchema(row.version.sections), 200);
  })
  .post("/:id/versions/:version/draft", canEdit, versionParam, async (c) => {
    const { id, version } = c.req.valid("param");
    const row = await findVersion(c.get("user"), id, version);
    if (!row) return c.json({ error: "Version not found" }, 404);
    const { name, description, sections, sampleData, themeId, page, content } = row.version;
    const before = await findDraft(id);
    const draft = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(template)
        .set({ name, description, sections, sampleData, themeId, page, content })
        .where(eq(template.id, id))
        .returning();
      await recordAudit(
        {
          action: "template.updated",
          target: { id, name },
          before,
          after: updated,
          details: { restoredFromVersion: row.version.version },
        },
        tx,
      );
      return updated;
    });
    return c.json(draft, 200);
  })
  .post(
    "/:id/versions/:version/generate",
    canView,
    versionParam,
    zValidator("json", generateFromTemplateSchema),
    async (c) => {
      const { id, version } = c.req.valid("param");
      const body = c.req.valid("json");
      const row = await findVersion(c.get("user"), id, version);
      if (!row) return c.json({ error: "Version not found" }, 404);
      if (row.archivedAt) return c.json({ error: "This template is archived" }, 409);
      const v = row.version;
      const parsed = templateDataSchema(v.sections).safeParse(body.data);
      if (!parsed.success) {
        return c.json({ error: "Invalid data", fieldErrors: fieldErrors(parsed.error) }, 422);
      }
      const result = await generate({
        request: versionRequest(v, parsed.data, body.filename ?? v.name, body.output),
        source: "app",
        userId: c.get("user").id,
        requestId: c.get("requestId"),
        template: { id, versionId: v.id },
        subject: body.subject,
        wait: !body.async,
      });
      return generationResponse(c, result);
    },
  );

/**
 * What a published version renders with this data. Self-contained (theme included, or the
 * overlay's source id), so a re-run from the log renders the same PDF.
 */
export function versionRequest(
  v: typeof templateVersion.$inferSelect,
  data: Record<string, unknown>,
  filename: string,
  /** Per-request output settings over the version's (docs/features/archival-accessible-and-certified-output.md). */
  overrides?: OutputOverrides,
): RenderInput {
  const { compiled } = v;
  const output = overrides
    ? { output: { ...defaultOutputOptions, ...compiled.output, ...overrides } }
    : {};
  if ("kind" in compiled) return { ...compiled, ...output, data, filename, preview: false };
  return {
    ...compiled,
    ...output,
    ...(v.theme ? { themeDraft: v.theme } : {}),
    page: v.page,
    data,
    filename,
    preview: false,
  };
}

function selectVersionSummaries() {
  return db
    .select(versionSummaryColumns)
    .from(templateVersion)
    .leftJoin(user, eq(user.id, templateVersion.publishedBy))
    .$dynamic();
}
