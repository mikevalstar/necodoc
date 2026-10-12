// ADR 0017: pdf.js renders uploaded PDFs in the overlay editor. Loaded on first use, so the rest
// of the app doesn't pay for it.

let loaded: Promise<typeof import("pdfjs-dist")> | undefined;

function pdfjs() {
  loaded ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return loaded;
}

// pdf.js decodes JPEG 2000 and JBIG2 images (common in scanned government forms) with wasm it
// fetches by file name. Bundled files get hashed names, so map the names to their URLs.
const wasm: Record<string, () => Promise<{ default: string }>> = {
  "openjpeg.wasm": () => import("pdfjs-dist/wasm/openjpeg.wasm?url"),
  "jbig2.wasm": () => import("pdfjs-dist/wasm/jbig2.wasm?url"),
};

class BinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const url = kind === "wasmUrl" ? wasm[filename] : undefined;
    if (!url) throw new Error(`pdf.js asked for ${kind} ${filename}, which isn't bundled`);
    const response = await fetch((await url()).default);
    if (!response.ok) throw new Error(`Couldn't load ${filename}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** Opens a PDF with the empty password encrypted government forms use (ADR 0027). */
export async function openPdf(url: string) {
  return (await pdfjs()).getDocument({ url, password: "", BinaryDataFactory });
}

export type PdfDocument = Awaited<Awaited<ReturnType<typeof openPdf>>["promise"]>;
export type PdfPageProxy = Awaited<ReturnType<PdfDocument["getPage"]>>;
export type PdfViewport = ReturnType<PdfPageProxy["getViewport"]>;
