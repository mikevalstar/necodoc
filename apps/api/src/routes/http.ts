import type { Context } from "hono";
import type { GenerationResult } from "../generate";

/** Headers for serving a stored PDF inline, with a filename for "save as". */
export const pdfHeaders = (filename: string) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
});

/**
 * Headers for serving user-uploaded bytes. The sandbox CSP stops an uploaded SVG from running
 * script if someone opens it directly.
 */
export const fileHeaders = (mimeType: string) => ({
  "Content-Type": mimeType,
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=31536000, immutable",
});

/**
 * How a generate call answers (ADR 0020): the PDF once it's rendered, 422 with the error, or 202
 * with the generation id to poll while it's still queued or running.
 */
export function generationResponse(c: Context, result: GenerationResult) {
  switch (result.status) {
    case "success":
      return c.body(result.pdf, 200, {
        ...pdfHeaders(result.filename),
        "X-Page-Count": String(result.pageCount),
        "X-Generation-Id": result.generationId,
      });
    case "error":
      return c.json({ error: result.error, generationId: result.generationId }, 422);
    default:
      return c.json({ generationId: result.generationId, status: result.status }, 202);
  }
}
