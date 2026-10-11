import { PDFDocument } from "@cantoo/pdf-lib";
import type { CombineRenderRequest, RenderTimings } from "@necodoc/shared";

// Spec: docs/features/combining-pdfs-into-packets.md. ADR 0013: pdf-lib merges; each input's
// form is flattened first, so field values survive and names can't clash across inputs.

/** A stored file's bytes, or null when it's gone (deleted, or removed by retention). */
export type FileLoader = (fileId: string) => Promise<Uint8Array | null>;

export async function renderCombine(request: CombineRenderRequest, load: FileLoader) {
  const started = performance.now();
  const packet = await PDFDocument.create();
  const warnings: string[] = [];
  for (const [i, part] of request.parts.entries()) {
    const label = `Input ${i + 1}`;
    const bytes = await load(part.fileId);
    if (!bytes) throw new Error(`${label}'s PDF is gone`);
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        /encrypt/i.test(reason)
          ? `${label} is encrypted; encrypted PDFs can't be combined`
          : `${label} isn't a readable PDF: ${reason}`,
      );
    }
    try {
      const form = doc.getForm();
      if (form.hasXFA()) form.deleteXFA();
      form.flatten();
    } catch (error) {
      warnings.push(
        `${label}: couldn't flatten its form: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const page of await packet.copyPages(doc, doc.getPageIndices())) packet.addPage(page);
  }
  const pdf = new Uint8Array(await packet.save());
  const timings: RenderTimings = {
    liquidMs: 0,
    chromiumMs: 0,
    bandsMs: 0,
    stampMs: Math.round(performance.now() - started),
  };
  return { pdf, pageCount: packet.getPageCount(), timings, warnings };
}
