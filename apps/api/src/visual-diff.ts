import { type Canvas, createCanvas } from "@napi-rs/canvas";
import type { PageDiff } from "@necodoc/shared";
import { renderPage } from "./detect/geometry";
import { openPdfjs, type PdfjsDocument } from "./render/pdfjs";

// Spec: docs/features/template-test-cases-and-visual-diff.md. Two renders of the same data,
// rasterised with pdf.js as AI detection does (ADR 0028), compared pixel by pixel per page.

/** 108 dpi: enough to read the text in the images, small enough to send a few pages as PNGs. */
const SCALE = 1.5;
/** Larger documents are compared on their first pages only. */
const MAX_DIFF_PAGES = 20;
/** pixelmatch's default: squared YIQ distance above 10% of the maximum counts as changed. */
const MAX_DELTA = 35215 * 0.1 * 0.1;

/** Each page's text, lines joined as pdf.js reports them. */
async function pageTexts(doc: PdfjsDocument, pages = doc.numPages) {
  const texts: string[] = [];
  for (let n = 1; n <= Math.min(pages, doc.numPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : "");
    }
    texts.push(text.replace(/[ \t]+\n/g, "\n").trim());
  }
  return texts;
}

/** Every page's text, for test assertions. */
export async function pdfText(pdf: Uint8Array) {
  const doc = await openPdfjs(pdf);
  try {
    return await pageTexts(doc);
  } finally {
    await doc.loadingTask.destroy();
  }
}

const png = (canvas: Canvas) =>
  `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;

/** The page on a white canvas of the given size, so pages of different sizes line up top-left. */
function padded(source: Canvas | null, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  if (source) context.drawImage(source, 0, 0);
  return canvas;
}

const luma = (r: number, g: number, b: number) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;

/**
 * Changed pixels and a diff image: unchanged ink faded to grey, ink only in the draft green, ink
 * only in the published version (or lighter in the draft) red.
 */
function pixelDiff(before: Canvas, after: Canvas) {
  const { width, height } = before;
  const a = before.getContext("2d").getImageData(0, 0, width, height).data;
  const b = after.getContext("2d").getImageData(0, 0, width, height).data;
  const out = createCanvas(width, height);
  const context = out.getContext("2d");
  const image = context.createImageData(width, height);
  const d = image.data;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const r1 = a[i] ?? 255;
    const g1 = a[i + 1] ?? 255;
    const b1 = a[i + 2] ?? 255;
    const r2 = b[i] ?? 255;
    const g2 = b[i + 1] ?? 255;
    const b2 = b[i + 2] ?? 255;
    const dy = luma(r1, g1, b1) - luma(r2, g2, b2);
    const di = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.2741761 - (b1 - b2) * 0.32180189;
    const dq = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694;
    const delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
    if (delta > MAX_DELTA) {
      changed++;
      // Darker in the draft: added ink.
      const added = dy > 0;
      d[i] = added ? 0 : 230;
      d[i + 1] = added ? 170 : 0;
      d[i + 2] = added ? 60 : 0;
    } else {
      const grey = 255 - (255 - luma(r2, g2, b2)) * 0.15;
      d[i] = grey;
      d[i + 1] = grey;
      d[i + 2] = grey;
    }
    d[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { changed, image: out };
}

/** Page by page: the published render (null on a first version) against the draft's. */
export async function visualDiff(
  beforePdf: Uint8Array | null,
  afterPdf: Uint8Array,
): Promise<{ pages: PageDiff[]; truncated: boolean }> {
  const before = beforePdf ? await openPdfjs(beforePdf) : null;
  const after = await openPdfjs(afterPdf);
  try {
    const total = Math.max(before?.numPages ?? 0, after.numPages);
    const count = Math.min(total, MAX_DIFF_PAGES);
    const [beforeText, afterText] = await Promise.all([
      before ? pageTexts(before, count) : [],
      pageTexts(after, count),
    ]);
    const pages: PageDiff[] = [];
    for (let n = 1; n <= count; n++) {
      const raster = async (doc: PdfjsDocument | null) =>
        doc && n <= doc.numPages ? renderPage(await doc.getPage(n), SCALE) : null;
      const a = await raster(before);
      const b = await raster(after);
      const width = Math.max(a?.width ?? 0, b?.width ?? 0);
      const height = Math.max(a?.height ?? 0, b?.height ?? 0);
      const pa = padded(a, width, height);
      const pb = padded(b, width, height);
      const { changed, image } =
        a && b ? pixelDiff(pa, pb) : { changed: width * height, image: null };
      pages.push({
        page: n,
        width,
        height,
        before: a ? png(pa) : null,
        after: b ? png(pb) : null,
        diff: image ? png(image) : null,
        changedPixels: changed,
        changedPercent: width * height ? (changed / (width * height)) * 100 : 0,
        beforeText: beforeText[n - 1] ?? "",
        afterText: afterText[n - 1] ?? "",
      });
    }
    return { pages, truncated: total > count };
  } finally {
    await before?.loadingTask.destroy();
    await after.loadingTask.destroy();
  }
}
