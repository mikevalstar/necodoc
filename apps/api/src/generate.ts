import { hostname } from "node:os";
import {
  type GenerationSource,
  type GenerationStatus,
  isFinishedStatus,
  MAX_FILE_BYTES,
  type RenderRequest,
} from "@necodoc/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { z } from "zod";
import { db } from "./db";
import { asset, file, generation, theme } from "./db/schema";
import { env } from "./env";
import { fileBytes, storeFile } from "./files";
import { limiter } from "./limiter";
import { announceFinished, boss, priorities, queues, waitUntilFinished } from "./queue";
import type { AssetLoader } from "./render/browser";
import { isInfrastructureError } from "./render/errors";
import { type RenderJob, renderPdf } from "./render/render";

// Specs: docs/features/generation-log.md, docs/features/render-queue-batch-jobs-and-scaling.md.
// ADR 0020: a logged render is a generation row plus a queued job; a worker renders it. Previews
// skip both and render here, on the API node.

/** host:pid, as workers report it in heartbeats and on the generations they run. */
export const processId = `${hostname()}:${process.pid}`;

/** Assets are global: anyone who can render can use any asset (docs/features/assets.md). */
export const loadStoredAsset: AssetLoader = async (id) => {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({ bytes: file.bytes, mimeType: file.mimeType })
    .from(asset)
    .innerJoin(file, eq(file.id, asset.fileId))
    .where(eq(asset.id, id));
  return row ?? null;
};

async function resolveTheme(request: RenderRequest): Promise<RenderJob["theme"]> {
  if (request.themeDraft) return request.themeDraft;
  if (!request.themeId) return undefined;
  const [row] = await db
    .select({ settings: theme.settings, css: theme.css })
    .from(theme)
    .where(eq(theme.id, request.themeId));
  if (!row) throw new Error(`Theme ${request.themeId} doesn't exist`);
  return row;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Renders with the theme resolved; refuses PDFs too big to store. */
async function render(request: RenderRequest) {
  const rendered = await renderPdf(
    { ...request, theme: await resolveTheme(request) },
    loadStoredAsset,
  );
  if (rendered.pdf.byteLength > MAX_FILE_BYTES) {
    throw new Error(`The PDF is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  return rendered;
}

export function pdfFilename(name: string | undefined) {
  const base = (name ?? "document").replace(/\.pdf$/i, "").replace(/[^\w .()-]+/g, "_");
  return `${base || "document"}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Previews

const previewSlot = limiter(() => env.PREVIEW_CONCURRENCY);

export type PreviewResult =
  | { ok: true; pdf: Uint8Array<ArrayBuffer>; pageCount: number; filename: string }
  | { ok: false; error: string };

/** In-process and unlogged, so editing never waits on the queue (ADR 0020). */
export async function renderPreview(request: RenderRequest): Promise<PreviewResult> {
  try {
    const { pdf, pageCount } = await previewSlot(() => render(request));
    return { ok: true, pdf, pageCount, filename: pdfFilename(request.filename) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------------------------
// Enqueue and wait (API side)

export type GenerationInput = {
  request: RenderRequest;
  source: GenerationSource;
  userId: string;
  requestId?: string;
  rerunOfId?: string;
  /** The published template version the request was built from. */
  template?: { id: string; versionId: string };
};

/** The row a queued generation starts as. Batch rows add their batch id and row number. */
export const queuedRow = ({
  request,
  source,
  userId,
  requestId,
  rerunOfId,
  template,
}: GenerationInput) =>
  ({
    source,
    status: "queued",
    userId,
    requestId,
    rerunOfId,
    templateId: template?.id,
    templateVersionId: template?.versionId,
    filename: pdfFilename(request.filename),
    input: { ...request, preview: false },
  }) satisfies typeof generation.$inferInsert;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inserts generations and a render job for each queued one, in the caller's transaction, so a row
 * never waits on a job that doesn't exist. Rows that are already finished (invalid batch rows)
 * get no job. Returns the ids in order.
 */
export async function enqueue(tx: Tx, rows: (typeof generation.$inferInsert)[], priority: number) {
  const ids: string[] = [];
  // Postgres caps a statement at 65,535 parameters.
  for (let i = 0; i < rows.length; i += 1000) {
    const inserted = await tx
      .insert(generation)
      .values(rows.slice(i, i + 1000))
      .returning({ id: generation.id, status: generation.status });
    const jobs = inserted
      .filter((row) => row.status === "queued")
      .map((row) => ({ data: { generationId: row.id }, priority }));
    if (jobs.length) await boss.insert(queues.render, jobs, { db: fromDrizzle(tx, sql) });
    ids.push(...inserted.map((row) => row.id));
  }
  return ids;
}

export type GenerationResult =
  | {
      status: "success";
      generationId: string;
      pdf: Uint8Array<ArrayBuffer>;
      pageCount: number;
      filename: string;
    }
  | { status: "error"; generationId: string; error: string }
  /** Still waiting: async mode, or the wait ran out. */
  | { status: Exclude<GenerationStatus, "success" | "error">; generationId: string };

/**
 * Logs and queues a render. With `wait`, holds on for the worker up to RENDER_WAIT_MS and returns
 * the PDF; otherwise (or past the wait) returns the generation id to poll.
 */
export async function generate(
  input: GenerationInput & { wait: boolean },
): Promise<GenerationResult> {
  const [generationId] = await db.transaction((tx) =>
    enqueue(tx, [queuedRow(input)], priorities.interactive),
  );
  if (!generationId) throw new Error("Generation insert returned no row");
  if (!input.wait) return { status: "queued", generationId };

  const load = () =>
    db
      .select({
        status: generation.status,
        error: generation.error,
        fileId: generation.outputFileId,
        filename: generation.filename,
        pageCount: generation.pageCount,
      })
      .from(generation)
      .where(eq(generation.id, generationId))
      .then(([found]) => found);
  let current: Awaited<ReturnType<typeof load>>;
  await waitUntilFinished(generationId, env.RENDER_WAIT_MS, async () => {
    current = await load();
    return !current || isFinishedStatus(current.status);
  });
  if (!current) return { status: "error", generationId, error: "The generation was deleted" };
  const { status } = current;
  if (status !== "success" && status !== "error") return { status, generationId };
  const stored = current.fileId ? await fileBytes(db, current.fileId) : null;
  if (status === "error" || !stored) {
    return { status: "error", generationId, error: current.error ?? "No PDF was stored" };
  }
  return {
    status,
    generationId,
    pdf: stored.bytes,
    pageCount: current.pageCount ?? 0,
    filename: current.filename,
  };
}

// ---------------------------------------------------------------------------------------------
// Run (worker side)

const unfinished = inArray(generation.status, ["queued", "running"]);

/** Records how an attempt ended, unless a later attempt took the row over. */
async function finish(
  generationId: string,
  attempt: number,
  outcome: Awaited<ReturnType<typeof render>> | { error: string },
  started: { at: Date; queuedAt: Date; userId: string | null },
) {
  const finishedAt = new Date();
  const durations = {
    finishedAt,
    durationMs: finishedAt.getTime() - started.at.getTime(),
    queueWaitMs: started.at.getTime() - started.queuedAt.getTime(),
    totalMs: finishedAt.getTime() - started.queuedAt.getTime(),
  };
  await db
    .transaction(async (tx) => {
      const output =
        "pdf" in outcome
          ? {
              status: "success" as const,
              outputFileId: await storeFile(tx, {
                bytes: outcome.pdf,
                mimeType: "application/pdf",
                ownerId: started.userId,
              }),
              pageCount: outcome.pageCount,
              size: outcome.pdf.byteLength,
              timings: outcome.timings,
            }
          : { status: "error" as const, error: outcome.error };
      const [updated] = await tx
        .update(generation)
        .set({ ...durations, ...output })
        .where(and(eq(generation.id, generationId), eq(generation.attempts, attempt), unfinished))
        .returning({ id: generation.id });
      // Superseded (a retry took over) or deleted: keep nothing from this attempt.
      if (!updated) tx.rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "TransactionRollbackError")) throw error;
    });
  await announceFinished(generationId);
}

/**
 * Renders one queued generation. Throws only for infrastructure failures with retries left, so
 * pg-boss runs it again; everything else is recorded on the row as an error.
 */
export async function runGeneration(generationId: string, attempt: number, retriesLeft: boolean) {
  const startedAt = new Date();
  const [row] = await db
    .update(generation)
    .set({ status: "running", startedAt, attempts: attempt, workerId: processId })
    .where(and(eq(generation.id, generationId), unfinished))
    .returning({
      input: generation.input,
      queuedAt: generation.queuedAt,
      userId: generation.userId,
    });
  // Cancelled, deleted or already finished.
  if (!row) return;
  const started = { at: startedAt, queuedAt: row.queuedAt, userId: row.userId };
  if (!row.input) {
    await finish(generationId, attempt, { error: "The input was removed by retention" }, started);
    return;
  }
  let outcome: Parameters<typeof finish>[2];
  try {
    outcome = await render(row.input);
  } catch (error) {
    if (retriesLeft && isInfrastructureError(error)) throw error;
    outcome = { error: errorMessage(error) };
  }
  await finish(generationId, attempt, outcome, started);
}

/** A job that ran out of attempts without recording an outcome: its workers kept dying. */
export async function markLost(generationId: string) {
  const [row] = await db
    .update(generation)
    .set({
      status: "error",
      error: "The render was lost: its worker stopped responding on every attempt",
      finishedAt: new Date(),
    })
    .where(and(eq(generation.id, generationId), unfinished))
    .returning({ id: generation.id });
  if (row) await announceFinished(generationId);
}
