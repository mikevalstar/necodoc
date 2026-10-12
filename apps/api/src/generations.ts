import { eq, isNotNull } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import { db } from "./db";
import { apikey, generation, template, user } from "./db/schema";

// Spec: docs/features/generation-log.md. The log's rows as the app and /api/v1 list them.

export const summaryColumns = {
  id: generation.id,
  source: generation.source,
  status: generation.status,
  userId: generation.userId,
  userName: user.name,
  apiKeyId: generation.apiKeyId,
  apiKeyName: apikey.name,
  templateId: generation.templateId,
  templateVersionId: generation.templateVersionId,
  templateName: template.name,
  rerunOfId: generation.rerunOfId,
  batchId: generation.batchId,
  batchRow: generation.batchRow,
  filename: generation.filename,
  error: generation.error,
  warnings: generation.warnings,
  queuedAt: generation.queuedAt,
  startedAt: generation.startedAt,
  finishedAt: generation.finishedAt,
  durationMs: generation.durationMs,
  queueWaitMs: generation.queueWaitMs,
  totalMs: generation.totalMs,
  attempts: generation.attempts,
  workerId: generation.workerId,
  pageCount: generation.pageCount,
  size: generation.size,
  hasOutput: isNotNull(generation.outputFileId).mapWith(Boolean),
};

/** Generations with their user, key and template names; `extra` adds columns (detail views). */
export const selectSummaries = <T extends SelectedFields>(extra: T) =>
  db
    .select({ ...summaryColumns, ...extra })
    .from(generation)
    .leftJoin(user, eq(user.id, generation.userId))
    .leftJoin(apikey, eq(apikey.id, generation.apiKeyId))
    .leftJoin(template, eq(template.id, generation.templateId));
