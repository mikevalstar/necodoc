import { zValidator } from "@hono/zod-validator";
import {
  compileDesignedContent,
  createTemplateSchema,
  fieldErrors,
  generateFromTemplateSchema,
  hasPermission,
  type Permissions,
  parseRoles,
  previewTemplateSchema,
  publishTemplateSchema,
  TemplateCompileError,
  templateDataSchema,
  templateJsonSchema,
  updateTemplateSchema,
  versionParamSchema,
} from "@necodoc/shared";
import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { LiquidError } from "liquidjs";
import { z } from "zod";
import { db } from "../db";
import { template, templateVersion, theme, user } from "../db/schema";
import { generate, renderPreview } from "../generate";
import {
  type AppEnv,
  requireAnyPermission,
  requirePermission,
  type SignedInEnv,
} from "../middleware";
import { liquid } from "../render/liquid";
import { generationResponse, pdfHeaders } from "./http";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md,
// docs/features/template-fields-and-guided-form.md. Drafts are for editors, reviewers and
// publishers; everyone with `document: view` sees and fills published, non-archived versions.

type SignedInUser = SignedInEnv["Variables"]["user"];

const draftAccess: Permissions[] = [
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

const latest = db
  .select({
    templateId: templateVersion.templateId,
    version: max(templateVersion.version).as("latest_version"),
  })
  .from(templateVersion)
  .groupBy(templateVersion.templateId)
  .as("latest");

async function findDraft(id: string) {
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

/** Compiles the body and bands, checking the Liquid parses, so publish fails early. */
function compileOrError(...args: Parameters<typeof compileDesignedContent>) {
  try {
    const compiled = compileDesignedContent(...args);
    const { html, header, footer } = compiled;
    for (const part of [
      html,
      header?.html,
      header?.firstPageHtml,
      footer?.html,
      footer?.firstPageHtml,
    ]) {
      if (part) liquid.parse(part);
    }
    return { compiled };
  } catch (error) {
    if (error instanceof TemplateCompileError || error instanceof LiquidError) {
      return { error: error.message };
    }
    throw error;
  }
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
        archivedAt: draft.archivedAt,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })),
    );
  })
  .post("/", canCreate, zValidator("json", createTemplateSchema), async (c) => {
    const body = c.req.valid("json");
    const error = await themeError(body.themeId);
    if (error) return c.json({ error }, 422);
    const [row] = await db
      .insert(template)
      .values({ ...body, createdBy: c.get("user").id })
      .returning();
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
    const error = await themeError(changes.themeId);
    if (error) return c.json({ error }, 422);
    const [row] = await db.update(template).set(changes).where(eq(template.id, id)).returning();
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
    const [deleted] = await db
      .delete(template)
      .where(eq(template.id, id))
      .returning({ id: template.id });
    return deleted ? c.body(null, 204) : c.json({ error: "Template not found" }, 404);
  })
  .post("/:id/duplicate", canCreate, idParam, async (c) => {
    const existing = await findDraft(c.req.valid("param").id);
    if (!existing) return c.json({ error: "Template not found" }, 404);
    const { id: _id, createdAt: _c, updatedAt: _u, archivedAt: _a, ...draft } = existing;
    const [row] = await db
      .insert(template)
      .values({ ...draft, name: `${draft.name} (copy)`, createdBy: c.get("user").id })
      .returning();
    return c.json(row, 201);
  })
  .post("/:id/archive", canPublish, idParam, async (c) => {
    const [row] = await db
      .update(template)
      .set({ archivedAt: new Date(), updatedAt: sql`${template.updatedAt}` })
      .where(eq(template.id, c.req.valid("param").id))
      .returning();
    return row ? c.json(row, 200) : c.json({ error: "Template not found" }, 404);
  })
  .post("/:id/restore", canPublish, idParam, async (c) => {
    const [row] = await db
      .update(template)
      .set({ archivedAt: null, updatedAt: sql`${template.updatedAt}` })
      .where(eq(template.id, c.req.valid("param").id))
      .returning();
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
      const draft = body.draft ?? saved;
      const { compiled, error } = compileOrError(draft.content, draft.sections);
      if (!compiled) return c.json({ error }, 422);
      const data = body.data ?? draft.sampleData;
      // Previews render even when the data doesn't fit yet; valid data gets show-ifs applied.
      const parsed = templateDataSchema(draft.sections).safeParse(data);
      const result = await renderPreview({
        ...compiled,
        ...(draft.themeId ? { themeId: draft.themeId } : {}),
        page: draft.page,
        data: parsed.success ? parsed.data : data,
        filename: saved.name,
        preview: true,
      });
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.body(result.pdf, 200, {
        ...pdfHeaders(result.filename),
        "X-Page-Count": String(result.pageCount),
        "X-Data-Valid": String(parsed.success),
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
      const { compiled, error } = compileOrError(draft.content, draft.sections);
      if (!compiled) return c.json({ error }, 422);
      const [themeRow] = draft.themeId
        ? await db
            .select({ settings: theme.settings, css: theme.css })
            .from(theme)
            .where(eq(theme.id, draft.themeId))
        : [];
      const {
        id: templateId,
        createdBy: _c,
        createdAt: _ca,
        updatedAt: _u,
        archivedAt: _a,
        ...snapshot
      } = draft;
      const row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ version: max(templateVersion.version) })
          .from(templateVersion)
          .where(eq(templateVersion.templateId, templateId));
        const [inserted] = await tx
          .insert(templateVersion)
          .values({
            ...snapshot,
            templateId,
            version: (current?.version ?? 0) + 1,
            theme: themeRow ?? null,
            compiled,
            note: c.req.valid("json").note || null,
            publishedBy: c.get("user").id,
          })
          .returning({ id: templateVersion.id });
        return inserted;
      });
      const [summary] = row
        ? await selectVersionSummaries().where(eq(templateVersion.id, row.id))
        : [];
      return c.json(summary, 201);
    },
  )
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
    const [draft] = await db
      .update(template)
      .set({ name, description, sections, sampleData, themeId, page, content })
      .where(eq(template.id, id))
      .returning();
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
        // Self-contained, theme included, so a re-run from the log renders the same PDF.
        request: {
          ...v.compiled,
          ...(v.theme ? { themeDraft: v.theme } : {}),
          page: v.page,
          data: parsed.data,
          filename: body.filename ?? v.name,
          preview: false,
        },
        source: "app",
        userId: c.get("user").id,
        requestId: c.get("requestId"),
        template: { id, versionId: v.id },
        wait: !body.async,
      });
      return generationResponse(c, result);
    },
  );

function selectVersionSummaries() {
  return db
    .select(versionSummaryColumns)
    .from(templateVersion)
    .leftJoin(user, eq(user.id, templateVersion.publishedBy))
    .$dynamic();
}
