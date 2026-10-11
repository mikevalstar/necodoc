import { type GenerationSource, MAX_FILE_BYTES, type RenderRequest } from "@necodoc/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { asset, file, generation, theme } from "./db/schema";
import { storeFile } from "./files";
import type { AssetLoader } from "./render/browser";
import { type RenderJob, renderPdf } from "./render/render";

// Renders a request and records it in the generation log (docs/features/generation-log.md).

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

export type GenerationResult =
  | {
      ok: true;
      pdf: Uint8Array<ArrayBuffer>;
      pageCount: number;
      filename: string;
      generationId: string | null;
    }
  | { ok: false; error: string; generationId: string | null };

type GenerateOptions = {
  request: RenderRequest;
  source: GenerationSource;
  userId: string;
  rerunOfId?: string;
  /** The published template version the request was built from. */
  template?: { id: string; versionId: string };
};

export async function generate({
  request,
  source,
  userId,
  rerunOfId,
  template,
}: GenerateOptions): Promise<GenerationResult> {
  const startedAt = new Date();
  const started = performance.now();
  const filename = pdfFilename(request.filename);
  let outcome: { pdf: Uint8Array<ArrayBuffer>; pageCount: number } | { error: string };
  try {
    const rendered = await renderPdf(
      { ...request, theme: await resolveTheme(request) },
      loadStoredAsset,
    );
    outcome =
      rendered.pdf.byteLength > MAX_FILE_BYTES
        ? { error: `The PDF is over ${MAX_FILE_BYTES / 1024 / 1024} MB` }
        : rendered;
  } catch (error) {
    outcome = { error: error instanceof Error ? error.message : String(error) };
  }
  const durationMs = Math.round(performance.now() - started);

  let generationId: string | null = null;
  if (!request.preview) {
    generationId = await db.transaction(async (tx) => {
      const output =
        "pdf" in outcome
          ? {
              outputFileId: await storeFile(tx, {
                bytes: outcome.pdf,
                mimeType: "application/pdf",
                ownerId: userId,
              }),
              pageCount: outcome.pageCount,
              size: outcome.pdf.byteLength,
            }
          : { error: outcome.error };
      const [row] = await tx
        .insert(generation)
        .values({
          source,
          status: "pdf" in outcome ? "success" : "error",
          userId,
          rerunOfId,
          templateId: template?.id,
          templateVersionId: template?.versionId,
          filename,
          input: request,
          startedAt,
          durationMs,
          ...output,
        })
        .returning({ id: generation.id });
      return row?.id ?? null;
    });
  }

  return "pdf" in outcome
    ? { ok: true, ...outcome, filename, generationId }
    : { ok: false, error: outcome.error, generationId };
}

function pdfFilename(name: string | undefined) {
  const base = (name ?? "document").replace(/\.pdf$/i, "").replace(/[^\w .()-]+/g, "_");
  return `${base || "document"}.pdf`;
}
