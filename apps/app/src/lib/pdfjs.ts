// ADR 0017: pdf.js renders uploaded PDFs in the overlay editor. Loaded on first use, so the rest
// of the app doesn't pay for it.

let loaded: Promise<typeof import("pdfjs-dist")> | undefined;

export function pdfjs() {
  loaded ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return loaded;
}

export type PdfDocument = Awaited<
  ReturnType<Awaited<ReturnType<typeof pdfjs>>["getDocument"]>["promise"]
>;
export type PdfPageProxy = Awaited<ReturnType<PdfDocument["getPage"]>>;
export type PdfViewport = ReturnType<PdfPageProxy["getViewport"]>;
