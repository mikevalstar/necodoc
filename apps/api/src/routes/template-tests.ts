import { zValidator } from "@hono/zod-validator";
import {
  createTestCaseSchema,
  runTestsSchema,
  type TestCaseFrom,
  templateDataSchema,
  updateTestCaseSchema,
  visualDiffSchema,
} from "@necodoc/shared";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { generation, submission, template, templateTestCase } from "../db/schema";
import { renderPreview, type Tx } from "../generate";
import {
  type AppEnv,
  canEdit,
  canSeeDrafts,
  demo,
  idParam,
  isAdmin,
  type SignedInEnv,
} from "../middleware";
import { draftRenderInput, savedDraft } from "../publish";
import { runTests } from "../template-tests";
import { findDraft, findVersion, versionRequest } from "../templates";
import { visualDiff } from "../visual-diff";

// Spec: docs/features/template-test-cases-and-visual-diff.md. Mounted under /templates. Cases
// are for editors to change and every drafts user to run; nothing here is logged.

const caseParam = zValidator("param", z.object({ id: z.uuid(), caseId: z.uuid() }));

type SignedInUser = SignedInEnv["Variables"]["user"];

/** Generations: the actor's own, or any for admins (as in the log). Documents: their own. */
async function dataFrom(actor: SignedInUser, templateId: string, from: TestCaseFrom) {
  if (from.kind === "data") return from.data;
  if (from.kind === "sample") return (await findDraft(templateId))?.sampleData ?? null;
  if (from.kind === "generation") {
    const [row] = await db
      .select({ input: generation.input })
      .from(generation)
      .where(
        and(
          eq(generation.id, from.id),
          eq(generation.templateId, templateId),
          isAdmin(actor) ? undefined : eq(generation.userId, actor.id),
        ),
      );
    return row?.input && "data" in row.input ? row.input.data : null;
  }
  const [row] = await db
    .select({ data: submission.data })
    .from(submission)
    .where(
      and(
        eq(submission.id, from.id),
        eq(submission.templateId, templateId),
        eq(submission.ownerId, actor.id),
      ),
    );
  return row?.data ?? null;
}

type TestCaseRow = typeof templateTestCase.$inferSelect;

/** Test cases show in their template's history. */
async function recordCase(
  tx: Tx,
  action: "template.test_created" | "template.test_updated" | "template.test_deleted",
  templateId: string,
  before: TestCaseRow | null,
  after: TestCaseRow | null,
) {
  const [owner] = await tx
    .select({ name: template.name, sections: template.sections })
    .from(template)
    .where(eq(template.id, templateId));
  const testCase = after ?? before;
  await recordAudit(
    {
      action,
      target: { id: templateId, name: owner?.name ?? null },
      before,
      after,
      details: { testCaseId: testCase?.id ?? null, testCaseName: testCase?.name ?? null },
      sections: owner?.sections,
    },
    tx,
  );
}

const listCases = (templateId: string) =>
  db
    .select()
    .from(templateTestCase)
    .where(eq(templateTestCase.templateId, templateId))
    .orderBy(asc(templateTestCase.name));

export const templateTestRoutes = new Hono<AppEnv>()
  .get("/:id/tests", canSeeDrafts, idParam, async (c) =>
    c.json(await listCases(c.req.valid("param").id), 200),
  )
  // What a new case can be made from: recent generations and documents of this template.
  .get("/:id/tests/sources", canEdit, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const actor = c.get("user");
    const [generations, documents] = await Promise.all([
      db
        .select({
          id: generation.id,
          filename: generation.filename,
          source: generation.source,
          queuedAt: generation.queuedAt,
        })
        .from(generation)
        .where(
          and(
            eq(generation.templateId, id),
            isNotNull(generation.input),
            isAdmin(actor) ? undefined : eq(generation.userId, actor.id),
          ),
        )
        .orderBy(desc(generation.queuedAt))
        .limit(25),
      db
        .select({ id: submission.id, name: submission.name, updatedAt: submission.updatedAt })
        .from(submission)
        .where(and(eq(submission.templateId, id), eq(submission.ownerId, actor.id)))
        .orderBy(desc(submission.updatedAt))
        .limit(25),
    ]);
    return c.json({ generations, documents }, 200);
  })
  .post("/:id/tests", canEdit, idParam, zValidator("json", createTestCaseSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { name, from, assertions } = c.req.valid("json");
    const data = await dataFrom(c.get("user"), id, from);
    if (!data) return c.json({ error: "Couldn't read data from that source" }, 404);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(templateTestCase)
        .values({
          templateId: id,
          name,
          data,
          assertions,
          source: from.kind,
          createdBy: c.get("user").id,
        })
        .onConflictDoNothing()
        .returning();
      if (created) await recordCase(tx, "template.test_created", id, null, created);
      return created;
    });
    return row ? c.json(row, 201) : c.json({ error: `A case named "${name}" exists` }, 409);
  })
  .patch(
    "/:id/tests/:caseId",
    canEdit,
    caseParam,
    zValidator("json", updateTestCaseSchema),
    async (c) => {
      const { id, caseId } = c.req.valid("param");
      const match = and(eq(templateTestCase.id, caseId), eq(templateTestCase.templateId, id));
      const row = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(templateTestCase).where(match);
        if (!before) return undefined;
        const [updated] = await tx
          .update(templateTestCase)
          .set(c.req.valid("json"))
          .where(match)
          .returning();
        await recordCase(tx, "template.test_updated", id, before, updated ?? null);
        return updated;
      });
      return row ? c.json(row, 200) : c.json({ error: "Test case not found" }, 404);
    },
  )
  .delete("/:id/tests/:caseId", canEdit, caseParam, async (c) => {
    const { id, caseId } = c.req.valid("param");
    const row = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(templateTestCase)
        .where(and(eq(templateTestCase.id, caseId), eq(templateTestCase.templateId, id)))
        .returning();
      if (deleted) await recordCase(tx, "template.test_deleted", id, deleted, null);
      return deleted;
    });
    return row ? c.body(null, 204) : c.json({ error: "Test case not found" }, 404);
  })
  .post(
    "/:id/tests/run",
    canSeeDrafts,
    demo.limit("render"),
    idParam,
    zValidator("json", runTestsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { caseIds } = c.req.valid("json");
      const draft = await findDraft(id);
      const typed = draft && savedDraft(draft);
      if (!draft || !typed) return c.json({ error: "Template not found" }, 404);
      const cases = caseIds
        ? (await listCases(id)).filter((t) => caseIds.includes(t.id))
        : await listCases(id);
      return c.json({ results: await runTests(typed, draft.name, cases) }, 200);
    },
  )
  // The latest published version and the saved draft, rendered with the same data, compared.
  .post(
    "/:id/visual-diff",
    canSeeDrafts,
    demo.limit("render"),
    idParam,
    zValidator("json", visualDiffSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const { caseId } = c.req.valid("json");
      const draft = await findDraft(id);
      const typed = draft && savedDraft(draft);
      if (!draft || !typed) return c.json({ error: "Template not found" }, 404);
      const [testCase] = caseId
        ? await db
            .select({ data: templateTestCase.data })
            .from(templateTestCase)
            .where(and(eq(templateTestCase.id, caseId), eq(templateTestCase.templateId, id)))
        : [{ data: draft.sampleData }];
      if (!testCase) return c.json({ error: "Test case not found" }, 404);
      const built = draftRenderInput(typed, testCase.data, draft.name);
      if (!built.input) return c.json({ error: built.error }, 422);
      const latest = await findVersion(c.get("user"), id, "latest");
      const before = latest
        ? (() => {
            const v = latest.version;
            const parsed = templateDataSchema(v.sections).safeParse(testCase.data);
            return {
              ...versionRequest(v, parsed.success ? parsed.data : testCase.data, v.name),
              preview: true,
            };
          })()
        : null;
      const [beforeRender, afterRender] = await Promise.all([
        before ? renderPreview(before) : null,
        renderPreview(built.input),
      ]);
      if (!afterRender.ok)
        return c.json({ error: `The draft doesn't render: ${afterRender.error}` }, 422);
      const diff = await visualDiff(beforeRender?.ok ? beforeRender.pdf : null, afterRender.pdf);
      return c.json(
        {
          baseVersion: latest?.version.version ?? null,
          beforeError: beforeRender && !beforeRender.ok ? beforeRender.error : null,
          ...diff,
        },
        200,
      );
    },
  );
