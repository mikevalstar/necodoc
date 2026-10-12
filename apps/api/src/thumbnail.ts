import type { RenderInput } from "@necodoc/shared";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { templateThumbnail } from "./db/schema";
import { renderPage } from "./detect/geometry";
import { renderPreview } from "./generate";
import { limiter } from "./limiter";
import { log } from "./log";
import { openPdfjs } from "./render/pdfjs";

// Spec: docs/features/document-templates.md (templates list). Page 1 of a template as a small
// WebP, rendered on first request and cached per template in template_thumbnail.

/** Pixels across: sharp on a ~180px card at 2x. */
const WIDTH = 360;
/** A failed render is retried after this, in case it was Chromium, not the template. */
const RETRY_FAILED_MS = 60 * 60 * 1000;

/** Renders behind editors' previews, a couple at a time, so a big gallery can't swamp them. */
const slot = limiter(() => 2);
const inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

/** What the thumbnail is rendered from: the latest version, or the saved draft before one. */
export const thumbnailSource = (latestVersionId: string | null, draftUpdatedAt: Date) =>
  latestVersionId ? `v-${latestVersionId}` : `d-${draftUpdatedAt.getTime()}`;

/** Page 1 at WIDTH pixels across, as WebP. */
export async function pageOneImage(pdf: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await openPdfjs(pdf);
  try {
    const page = await doc.getPage(1);
    const canvas = await renderPage(page, WIDTH / page.getViewport({ scale: 1 }).width);
    return new Uint8Array(await canvas.encode("webp", 82));
  } finally {
    await doc.loadingTask.destroy();
  }
}

async function render(input: RenderInput) {
  const result = await renderPreview(input);
  if (!result.ok) throw new Error(result.error);
  return pageOneImage(result.pdf);
}

/**
 * The cached image for `source`, rendering and storing it when the cache holds an older one.
 * Null when the template doesn't render (or `input` has nothing to render).
 */
export async function cachedThumbnail(
  templateId: string,
  source: string,
  input: () => Promise<RenderInput | null>,
) {
  const [row] = await db
    .select({ image: templateThumbnail.image, createdAt: templateThumbnail.createdAt })
    .from(templateThumbnail)
    .where(and(eq(templateThumbnail.templateId, templateId), eq(templateThumbnail.source, source)));
  if (row && (row.image || Date.now() - row.createdAt.getTime() < RETRY_FAILED_MS)) {
    return row.image;
  }
  const key = `${templateId}:${source}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = slot(async () => {
      const request = await input();
      const image = request
        ? await render(request).catch((error: unknown) => {
            log.warn({ templateId, source, err: error }, "template thumbnail failed");
            return null;
          })
        : null;
      const values = { templateId, source, image, createdAt: new Date() };
      await db
        .insert(templateThumbnail)
        .values(values)
        .onConflictDoUpdate({ target: templateThumbnail.templateId, set: values });
      return image;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}
