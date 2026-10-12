import { fieldErrors, type GenerationSource, templateDataSchema } from "@necodoc/shared";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { generation, shareLink, submission, templateVersion } from "./db/schema";
import { generate } from "./generate";
import { versionRequest } from "./templates";

// Spec: docs/features/filling-out-a-document.md. Documents and finishing them, shared by the
// submission and share-link routes.

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
