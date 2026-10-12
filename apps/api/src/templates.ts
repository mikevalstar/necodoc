import { defaultOutputOptions, type OutputOverrides, type RenderInput } from "@necodoc/shared";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "./db";
import { template, templateVersion, user } from "./db/schema";
import { seesDrafts } from "./middleware";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md. Lookups
// the template, submission, batch, review and /api/v1 routes share.

/** Each template's latest published version number, as a subquery to join. */
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
export async function findVersion(
  actor: { role?: string | null },
  id: string,
  version: "latest" | number,
) {
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
