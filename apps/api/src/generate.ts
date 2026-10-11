import { hostname } from "node:os";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import {
  compiledSources,
  type GenerationSource,
  type GenerationStatus,
  isFinishedStatus,
  MAX_FILE_BYTES,
  type RenderInput,
  type RenderRequest,
  type RenderTimings,
  type SigningPackage,
} from "@necodoc/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { z } from "zod";
import { db } from "./db";
import { asset, file, generation, pdfSource, theme } from "./db/schema";
import { env } from "./env";
import {
  deleteObjects,
  findFile,
  openFile,
  StorageError,
  type WrittenOutput,
  writeOutput,
} from "./files";
import { limiter } from "./limiter";
import { announceFinished, boss, priorities, queues, waitUntilFinished } from "./queue";
import type { AssetLoader } from "./render/browser";
import { type FileLoader, renderCombine } from "./render/combine";
import { isInfrastructureError } from "./render/errors";
import { renderOverlay, type SourceLoader } from "./render/overlay";
import { loadPartials } from "./render/partials";
import { type RenderJob, renderPdf } from "./render/render";
import { completeBatch, queueGenerationEvents } from "./webhooks";

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
  return row?.bytes ? { bytes: row.bytes, mimeType: row.mimeType } : null;
};

/** An overlay template's uploaded PDF (base data, in Postgres: ADR 0014). */
export const loadSourceBytes: SourceLoader = async (sourceId) => {
  const [row] = await db
    .select({ bytes: file.bytes })
    .from(pdfSource)
    .innerJoin(file, eq(file.id, pdfSource.fileId))
    .where(eq(pdfSource.id, sourceId));
  return row?.bytes ?? null;
};

/** A packet's inputs: stored generation outputs and uploaded PDFs, wherever their bytes are. */
const loadFileBytes: FileLoader = async (fileId) => {
  const stored = await findFile(db, fileId);
  return stored ? new Uint8Array(await buffer(await openFile(db, stored))) : null;
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

/** A published version's frozen snippets, or the current ones (drafts, API HTML). */
const resolvePartials = (request: RenderRequest) =>
  request.partials ?? loadPartials(compiledSources(request));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * HTML through Chromium (theme and snippets resolved), a PDF overlay through pdf-lib, or a packet of stored
 * PDFs. Refuses PDFs too big to store.
 */
async function render(request: RenderInput) {
  const rendered: {
    pdf: Uint8Array<ArrayBuffer>;
    pageCount: number;
    timings: RenderTimings;
    warnings: string[];
    signing?: SigningPackage;
  } = !("kind" in request)
    ? {
        ...(await renderPdf(
          {
            ...request,
            theme: await resolveTheme(request),
            partials: await resolvePartials(request),
          },
          loadStoredAsset,
        )),
        warnings: [],
      }
    : request.kind === "overlay"
      ? await renderOverlay(request, loadSourceBytes, loadStoredAsset)
      : await renderCombine(request, loadFileBytes);
  if (rendered.pdf.byteLength > MAX_FILE_BYTES) {
    throw new Error(`The PDF is over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  // Packets don't carry their parts' signing packages (docs/features/signing-packages.md).
  const signing = rendered.signing ?? null;
  return { ...rendered, signing, warnings: [...rendered.warnings, ...(signing?.warnings ?? [])] };
}

export function pdfFilename(name: string | undefined) {
  const base = (name ?? "document").replace(/\.pdf$/i, "").replace(/[^\w .()-]+/g, "_");
  return `${base || "document"}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Previews

const previewSlot = limiter(() => env.PREVIEW_CONCURRENCY);

export type PreviewResult =
  | {
      ok: true;
      pdf: Uint8Array<ArrayBuffer>;
      pageCount: number;
      filename: string;
      warnings: string[];
    }
  | { ok: false; error: string };

/** In-process and unlogged, so editing never waits on the queue (ADR 0020). */
export async function renderPreview(request: RenderInput): Promise<PreviewResult> {
  try {
    const { pdf, pageCount, warnings } = await previewSlot(() => render(request));
    return { ok: true, pdf, pageCount, filename: pdfFilename(request.filename), warnings };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------------------------
// Enqueue and wait (API side)

export type GenerationInput = {
  request: RenderInput;
  source: GenerationSource;
  userId: string;
  /** Made through /api/v1 with this key (docs/features/html-to-pdf-api.md). */
  apiKeyId?: string;
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
  apiKeyId,
  requestId,
  rerunOfId,
  template,
}: GenerationInput) =>
  ({
    source,
    status: "queued",
    userId,
    apiKeyId,
    requestId,
    rerunOfId,
    templateId: template?.id,
    templateVersionId: template?.versionId,
    filename: pdfFilename(request.filename),
    input: { ...request, preview: false },
  }) satisfies typeof generation.$inferInsert;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
      /** Served from storage by src/download.ts. */
      fileId: string;
      pageCount: number;
      size: number;
      filename: string;
    }
  | { status: "error"; generationId: string; error: string }
  /** Still waiting: async mode, or the wait ran out. */
  | { status: Exclude<GenerationStatus, "success" | "error">; generationId: string };

/**
 * Logs and queues a render. With `wait`, holds on for the worker up to RENDER_WAIT_MS and returns
 * the stored PDF's id; otherwise (or past the wait) returns the generation id to poll.
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
        size: generation.size,
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
  if (status === "error" || !current.fileId) {
    return { status: "error", generationId, error: current.error ?? "No PDF was stored" };
  }
  return {
    status,
    generationId,
    fileId: current.fileId,
    pageCount: current.pageCount ?? 0,
    size: current.size ?? 0,
    filename: current.filename,
  };
}

// ---------------------------------------------------------------------------------------------
// Run (worker side)

const unfinished = inArray(generation.status, ["queued", "running"]);

type Outcome = (Awaited<ReturnType<typeof render>> & { output: WrittenOutput }) | { error: string };

/**
 * Records how an attempt ended, unless a later attempt took the row over, and queues its webhooks
 * in the same transaction. The output is already in storage; if the row isn't updated, the object
 * is deleted again.
 */
async function finish(
  generationId: string,
  attempt: number,
  outcome: Outcome,
  started: { at: Date; queuedAt: Date; batchId: string | null },
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
      if ("output" in outcome) await tx.insert(file).values(outcome.output);
      const output =
        "output" in outcome
          ? {
              status: "success" as const,
              outputFileId: outcome.output.id,
              pageCount: outcome.pageCount,
              size: outcome.output.size,
              timings: outcome.timings,
              warnings: outcome.warnings,
              signing: outcome.signing,
            }
          : { status: "error" as const, error: outcome.error };
      const [updated] = await tx
        .update(generation)
        .set({ ...durations, ...output })
        .where(and(eq(generation.id, generationId), eq(generation.attempts, attempt), unfinished))
        .returning({ id: generation.id });
      // Superseded (a retry took over) or deleted: keep nothing from this attempt.
      if (!updated) tx.rollback();
      await queueGenerationEvents(tx, generationId);
    })
    .catch(async (error: unknown) => {
      if ("output" in outcome) await deleteObjects([outcome.output]);
      if (!(error instanceof Error && error.name === "TransactionRollbackError")) throw error;
    });
  await announceFinished(generationId);
  // After the commit, so the batch's last row sees every other row finished.
  if (started.batchId) await completeBatch(started.batchId);
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
      batchId: generation.batchId,
    });
  // Cancelled, deleted or already finished.
  if (!row) return;
  const started = { at: startedAt, queuedAt: row.queuedAt, batchId: row.batchId };
  if (!row.input) {
    await finish(generationId, attempt, { error: "The input was removed by retention" }, started);
    return;
  }
  let outcome: Outcome;
  try {
    const rendered = await render(row.input);
    // Streamed to the driver (ADR 0023); the PDF itself comes out of pdf-lib whole.
    const output = await writeOutput({
      body: Readable.from([rendered.pdf]),
      mimeType: "application/pdf",
      ownerId: row.userId,
    });
    outcome = { ...rendered, output };
  } catch (error) {
    if (retriesLeft && (isInfrastructureError(error) || error instanceof StorageError)) throw error;
    outcome = { error: errorMessage(error) };
  }
  await finish(generationId, attempt, outcome, started);
}

/** A job that ran out of attempts without recording an outcome: its workers kept dying. */
export async function markLost(generationId: string) {
  const row = await db.transaction(async (tx) => {
    const [lost] = await tx
      .update(generation)
      .set({
        status: "error",
        error: "The render was lost: its worker stopped responding on every attempt",
        finishedAt: new Date(),
      })
      .where(and(eq(generation.id, generationId), unfinished))
      .returning({ id: generation.id, batchId: generation.batchId });
    if (lost) await queueGenerationEvents(tx, generationId);
    return lost;
  });
  if (!row) return;
  await announceFinished(generationId);
  if (row.batchId) await completeBatch(row.batchId);
}
