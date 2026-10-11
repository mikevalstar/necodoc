import { zValidator } from "@hono/zod-validator";
import {
  compileDesignedContent,
  compiledSources,
  compileSnippet,
  createSnippetSchema,
  designedContentSchema,
  partialNames,
  type SnippetContent,
  type SnippetUsage,
  TemplateCompileError,
  updateSnippetSchema,
} from "@necodoc/shared";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { snippet, template, templateVersion } from "../db/schema";
import { type AppEnv, requireAnyPermission, requirePermission } from "../middleware";
import { loadPartials, PartialError } from "../render/partials";
import { latest } from "./templates";

// Spec: docs/features/snippet-library.md. Same permissions as templates: create to add, edit to
// change, archive and delete; anyone who opens drafts can read them.

const canSee = requireAnyPermission(
  { document: ["edit"] },
  { document: ["review"] },
  { document: ["publish"] },
  { document: ["create"] },
);
const canCreate = requirePermission({ document: ["create"] });
const canEdit = requirePermission({ document: ["edit"] });

const idParam = zValidator("param", z.object({ id: z.uuid() }));

type SnippetRow = typeof snippet.$inferSelect;

/** Why the content can't be saved: it doesn't compile, includes a missing snippet, or loops. */
async function contentError(own: { id?: string; key: string }, content: SnippetContent) {
  try {
    const html = compileSnippet(content);
    // Loading the snippet itself checks everything it includes, its own new content first.
    await loadPartials([`{% render '${own.key}' %}`], { ...own, html });
    return null;
  } catch (error) {
    if (error instanceof PartialError || error instanceof TemplateCompileError) {
      return error.message;
    }
    throw error;
  }
}

const names = (row: Pick<SnippetRow, "id" | "key">) => [row.id, row.key];

/** Partials a template's draft names directly; none when the draft doesn't compile. */
function draftPartials(row: Pick<typeof template.$inferSelect, "content" | "sections">) {
  const content = designedContentSchema.safeParse(row.content);
  if (!content.success) return [];
  try {
    return compiledSources(compileDesignedContent(content.data, row.sections)).flatMap(
      partialNames,
    );
  } catch (error) {
    if (error instanceof TemplateCompileError) return [];
    throw error;
  }
}

/**
 * Templates whose draft includes the snippet or whose latest version was published with it,
 * flagging versions whose copy differs from the snippet now. Snippets that include it, too.
 */
async function usage(row: SnippetRow) {
  const own = names(row);
  const current = compileSnippet(row.content);
  const templates = await db
    .select({
      id: template.id,
      name: template.name,
      content: template.content,
      sections: template.sections,
      latestVersion: templateVersion.version,
      compiled: templateVersion.compiled,
    })
    .from(template)
    .leftJoin(latest, eq(latest.templateId, template.id))
    .leftJoin(
      templateVersion,
      and(eq(templateVersion.templateId, template.id), eq(templateVersion.version, latest.version)),
    )
    .where(eq(template.kind, "designed"))
    .orderBy(asc(template.name));
  const usedBy: SnippetUsage[] = templates.flatMap((t) => {
    const inDraft = draftPartials(t).some((name) => own.includes(name));
    const partials = t.compiled && !("kind" in t.compiled) ? t.compiled.partials : undefined;
    const copy = partials?.[row.id] ?? partials?.[row.key];
    if (!inDraft && copy === undefined) return [];
    return [
      {
        templateId: t.id,
        name: t.name,
        latestVersion: t.latestVersion,
        inDraft,
        inLatestVersion: copy !== undefined,
        outOfDate: copy !== undefined && copy !== current,
      },
    ];
  });
  const others = await db
    .select({ id: snippet.id, name: snippet.name, content: snippet.content })
    .from(snippet);
  const includedIn = others
    .filter(
      (s) =>
        s.id !== row.id && partialNames(compileSnippet(s.content)).some((n) => own.includes(n)),
    )
    .map(({ id, name }) => ({ id, name }));
  return { usedBy, includedIn };
}

async function findSnippet(id: string) {
  const [row] = await db.select().from(snippet).where(eq(snippet.id, id));
  return row ?? null;
}

export const snippetRoutes = new Hono<AppEnv>()
  .get("/", canSee, async (c) => c.json(await db.select().from(snippet).orderBy(asc(snippet.name))))
  .post("/", canCreate, zValidator("json", createSnippetSchema), async (c) => {
    const body = c.req.valid("json");
    const [taken] = await db
      .select({ id: snippet.id })
      .from(snippet)
      .where(eq(snippet.key, body.key));
    if (taken) return c.json({ error: `The key "${body.key}" is taken` }, 409);
    const error = await contentError({ key: body.key }, body.content);
    if (error) return c.json({ error }, 422);
    const [row] = await db
      .insert(snippet)
      .values({ ...body, createdBy: c.get("user").id })
      .returning();
    return c.json(row, 201);
  })
  .get("/:id", canSee, idParam, async (c) => {
    const row = await findSnippet(c.req.valid("param").id);
    if (!row) return c.json({ error: "Snippet not found" }, 404);
    return c.json({ ...row, ...(await usage(row)) }, 200);
  })
  .patch("/:id", canEdit, idParam, zValidator("json", updateSnippetSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { archived, ...changes } = c.req.valid("json");
    const existing = await findSnippet(id);
    if (!existing) return c.json({ error: "Snippet not found" }, 404);
    const error = changes.content ? await contentError(existing, changes.content) : null;
    if (error) return c.json({ error }, 422);
    const [row] = await db
      .update(snippet)
      .set({
        ...changes,
        ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
      })
      .where(eq(snippet.id, id))
      .returning();
    if (!row) return c.json({ error: "Snippet not found" }, 404);
    return c.json({ ...row, ...(await usage(row)) }, 200);
  })
  .delete("/:id", canEdit, idParam, async (c) => {
    const row = await findSnippet(c.req.valid("param").id);
    if (!row) return c.json({ error: "Snippet not found" }, 404);
    // Published versions keep their own copy; drafts and other snippets would break.
    const { usedBy, includedIn } = await usage(row);
    const users = [...usedBy.filter((u) => u.inDraft), ...includedIn].map((u) => u.name);
    if (users.length) {
      return c.json(
        { error: `Used by ${users.join(", ")}; remove it there or archive it instead` },
        409,
      );
    }
    await db.delete(snippet).where(eq(snippet.id, row.id));
    return c.body(null, 204);
  });
