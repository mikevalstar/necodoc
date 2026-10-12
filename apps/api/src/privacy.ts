import {
  type ErasureReport,
  type FieldSection,
  maskData,
  type RenderInput,
  type SubjectMatches,
} from "@necodoc/shared";
import { and, desc, eq, inArray, notInArray, type SQL, sql } from "drizzle-orm";
import { recordAudit } from "./audit";
import { db } from "./db";
import {
  downloadLink,
  file,
  generation,
  submission,
  template,
  templateVersion,
  user,
  webhookDelivery,
} from "./db/schema";
import { deleteFiles, deleteObjects } from "./files";

// Spec: docs/features/personal-data-masking-and-erasure.md, ADR 0039. Masking what non-owners see,
// and finding and erasing everything stored about one data subject.

async function versionSections(versionId: string | null): Promise<FieldSection[] | null> {
  if (!versionId) return null;
  const [row] = await db
    .select({ sections: templateVersion.sections })
    .from(templateVersion)
    .where(eq(templateVersion.id, versionId));
  return row?.sections ?? null;
}

/** A stored input with its data's sensitive values masked, by its version's fields when it has one. */
export async function maskedInput(input: RenderInput, versionId: string | null) {
  if (!("data" in input)) return input;
  return { ...input, data: maskData(input.data, await versionSections(versionId)) };
}

// ---------------------------------------------------------------------------------------------
// Finding a data subject

/** Most matches of each kind one search lists (and one erasure deletes). */
const MATCH_LIMIT = 500;

/**
 * Whether any string anywhere in `doc` equals `value` (already lowercase). Exact, so a common word
 * never matches unrelated people; lowercasing the JSON text keeps it valid JSON.
 */
const holdsValue = (doc: SQL, value: string) =>
  sql<boolean>`jsonb_path_exists(lower((${doc})::text)::jsonb, 'strict $.** ? (@ == $q)', jsonb_build_object('q', ${value}::text))`;

/** Packets (combine generations) built from any of these generations. */
const packetsOf = (ids: string[]) =>
  and(
    sql`${generation.input}->>'kind' = 'combine'`,
    sql`exists (select 1 from jsonb_array_elements(${generation.input}->'parts') part where part->>'generationId' in ${ids})`,
  );

const generationColumns = (matchedBy: SQL<"subject" | "value" | "packet">) => ({
  id: generation.id,
  source: generation.source,
  status: generation.status,
  filename: generation.filename,
  templateName: template.name,
  userName: user.name,
  subject: generation.subject,
  queuedAt: generation.queuedAt,
  matchedBy,
});

const selectGenerations = (
  matchedBy: SQL<"subject" | "value" | "packet">,
  where: SQL | undefined,
) =>
  db
    .select(generationColumns(matchedBy))
    .from(generation)
    .leftJoin(user, eq(user.id, generation.userId))
    .leftJoin(template, eq(template.id, generation.templateId))
    .where(where)
    .orderBy(desc(generation.queuedAt))
    .limit(MATCH_LIMIT + 1);

/**
 * Generations whose subject key or stored data/signers hold `q`, packets built from them (and from
 * those, a few levels deep), and submissions whose answers or respondent email hold it.
 */
export async function findSubject(q: string): Promise<SubjectMatches> {
  const value = q.toLowerCase();
  const subjectIs = sql`lower(${generation.subject}) = ${value}`;
  const direct = await selectGenerations(
    sql<"subject" | "value">`case when ${subjectIs} then 'subject' else 'value' end`,
    sql`(${subjectIs} or ${holdsValue(
      sql`jsonb_build_array(${generation.input}->'data', ${generation.input}->'signers')`,
      value,
    )})`,
  );
  const generations = [...direct];
  let latest = direct;
  for (let depth = 0; depth < 5 && latest.length && generations.length <= MATCH_LIMIT; depth++) {
    latest = await selectGenerations(
      sql<"packet">`'packet'`,
      and(
        packetsOf(latest.map((g) => g.id)),
        notInArray(
          generation.id,
          generations.map((g) => g.id),
        ),
      ),
    );
    generations.push(...latest);
  }

  const emailIs = sql`lower(${submission.respondentEmail}) = ${value}`;
  const submissions = await db
    .select({
      id: submission.id,
      name: submission.name,
      status: submission.status,
      ownerName: user.name,
      respondentEmail: submission.respondentEmail,
      createdAt: submission.createdAt,
      matchedBy: sql<
        "respondent_email" | "value"
      >`case when ${emailIs} then 'respondent_email' else 'value' end`,
    })
    .from(submission)
    .leftJoin(user, eq(user.id, submission.ownerId))
    .where(sql`(${emailIs} or ${holdsValue(sql`${submission.data}`, value)})`)
    .orderBy(desc(submission.createdAt))
    .limit(MATCH_LIMIT + 1);

  return {
    generations: generations.slice(0, MATCH_LIMIT).map((g) => ({
      ...g,
      queuedAt: g.queuedAt.toISOString(),
    })),
    submissions: submissions.slice(0, MATCH_LIMIT).map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    truncated: generations.length > MATCH_LIMIT || submissions.length > MATCH_LIMIT,
  };
}

// ---------------------------------------------------------------------------------------------
// Erasing

/**
 * Deletes the picked matches of `q` (ids that don't match it any more are skipped): submissions,
 * generations with their webhook deliveries and signed-link records, and their stored files.
 * Objects go from the driver after the commit; the audit entry records counts only.
 */
export async function eraseSubject(request: {
  q: string;
  generationIds: string[];
  submissionIds: string[];
}): Promise<ErasureReport> {
  const found = await findSubject(request.q);
  const pickedGenerations = new Set(request.generationIds);
  const pickedSubmissions = new Set(request.submissionIds);
  const generationIds = found.generations
    .map((g) => g.id)
    .filter((id) => pickedGenerations.has(id));
  const submissionIds = found.submissions
    .map((s) => s.id)
    .filter((id) => pickedSubmissions.has(id));

  const erased = await db.transaction(async (tx) => {
    const deliveries = generationIds.length
      ? await tx
          .delete(webhookDelivery)
          .where(inArray(webhookDelivery.generationId, generationIds))
          .returning({ id: webhookDelivery.id })
      : [];
    const links = generationIds.length
      ? await tx
          .delete(downloadLink)
          .where(inArray(downloadLink.generationId, generationIds))
          .returning({ id: downloadLink.id })
      : [];
    if (submissionIds.length)
      await tx.delete(submission).where(inArray(submission.id, submissionIds));
    const rows = generationIds.length
      ? await tx
          .delete(generation)
          .where(inArray(generation.id, generationIds))
          .returning({ outputFileId: generation.outputFileId })
      : [];
    const fileIds = rows.flatMap((row) => (row.outputFileId ? [row.outputFileId] : []));
    const objects = fileIds.length ? await deleteFiles(tx, inArray(file.id, fileIds)) : [];
    const counts = {
      generations: generationIds.length,
      submissions: submissionIds.length,
      files: objects.length,
      webhookDeliveries: deliveries.length,
      downloadLinks: links.length,
    };
    await recordAudit(
      {
        action: "privacy.subject_erased",
        target: { id: null, name: "Data subject" },
        details: counts,
      },
      tx,
    );
    return { objects, counts };
  });
  const objectsLeftBehind = await deleteObjects(erased.objects);
  return {
    erasedAt: new Date().toISOString(),
    generationIds,
    submissionIds,
    files: erased.counts.files,
    webhookDeliveries: erased.counts.webhookDeliveries,
    downloadLinks: erased.counts.downloadLinks,
    objectsLeftBehind,
  };
}
