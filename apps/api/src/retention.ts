import { type RetentionSettings, retentionSettingsSchema } from "@necodoc/shared";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "./db";
import { file, generation, setting } from "./db/schema";
import { deleteFiles, deleteObjects } from "./files";

// Spec: docs/features/generation-log.md (retention). Runs daily as a pg-boss cron job (ADR 0020)
// and on demand from Admin > System. Metadata always stays.

const KEEP_FOREVER: RetentionSettings = { outputDays: null, inputDays: null };

export async function retentionSettings(): Promise<RetentionSettings> {
  const [row] = await db.select().from(setting).where(eq(setting.key, "retention"));
  return row ? retentionSettingsSchema.parse(row.value) : KEEP_FOREVER;
}

export async function saveRetentionSettings(value: RetentionSettings, userId: string) {
  await db
    .insert(setting)
    .values({ key: "retention", value, updatedBy: userId })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: userId } });
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Deletes outputs and inputs of generations that finished more than N days ago. */
export async function runRetention() {
  const { outputDays, inputDays } = await retentionSettings();
  // The FK sets output_file_id to null as the files go; their objects go after (ADR 0023).
  const outputs = outputDays
    ? await deleteFiles(
        db,
        inArray(
          file.id,
          db
            .select({ id: generation.outputFileId })
            .from(generation)
            .where(lt(generation.finishedAt, daysAgo(outputDays))),
        ),
      )
    : [];
  await deleteObjects(outputs);
  const inputs = inputDays
    ? (
        await db
          .update(generation)
          .set({ input: null })
          .where(and(isNotNull(generation.input), lt(generation.finishedAt, daysAgo(inputDays))))
          .returning({ id: generation.id })
      ).length
    : 0;
  return { outputsDeleted: outputs.length, inputsDeleted: inputs };
}
