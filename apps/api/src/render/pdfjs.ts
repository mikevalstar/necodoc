import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// ADR 0028: pdf.js in Node reads uploads (page boxes, AcroForm fields) and rasterises pages for
// AI detection. Uploads are untrusted: no system fonts (pdf.js 6 has no eval path).

const require = createRequire(import.meta.url);
const standardFontDataUrl = `${join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;

export { pdfjs };
export type PdfjsDocument = Awaited<ReturnType<typeof openPdfjs>>;
export type PdfjsPage = Awaited<ReturnType<PdfjsDocument["getPage"]>>;
export type PdfjsViewport = ReturnType<PdfjsPage["getViewport"]>;

/** Opens a PDF, with the empty password that encrypted government forms use (ADR 0027). */
export function openPdfjs(bytes: Uint8Array) {
  return pdfjs.getDocument({
    // pdf.js transfers (detaches) the buffer it's given.
    data: bytes.slice(),
    password: "",
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
    verbosity: 0,
  }).promise;
}
