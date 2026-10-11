import { createCanvas } from "@napi-rs/canvas";
import { type PdfjsPage, type PdfjsViewport, pdfjs } from "../render/pdfjs";

// ADR 0028: page geometry for AI field detection, all from pdf.js and a raster of the page.
// Coordinates are "viewport points": top-left origin, y down, 1 unit = 1 PDF point, rotation and
// crop box applied. Convert to PDF user space only at the edge, with toPdfRect.

export type Box = { x: number; y: number; w: number; h: number };
type TextItem = Box & { str: string; baseline: number; fontH: number };
export type PageGeometry = { hLines: Box[]; vLines: Box[]; squares: Box[]; text: TextItem[] };

/** Rasterises with annotations off, so existing widgets never show in what the model sees. */
export async function renderPage(page: PdfjsPage, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // @napi-rs/canvas implements the part of the DOM canvas API pdf.js draws with.
  await page.render({
    canvasContext: context as never,
    canvas: canvas as never,
    viewport,
    annotationMode: pdfjs.AnnotationMode.DISABLE,
  }).promise;
  return canvas;
}

async function pageText(page: PdfjsPage, viewport: PdfjsViewport): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [, , c = 0, d = 0, e = 0, f = 0] = pdfjs.Util.transform(
      viewport.transform,
      item.transform,
    );
    const fontH = Math.hypot(c, d);
    items.push({
      str: item.str,
      x: e,
      y: f - fontH * 0.8,
      w: item.width * viewport.scale,
      h: fontH,
      baseline: f,
      fontH,
    });
  }
  return items;
}

/** 216 dpi: lines land within a third of a point. */
const RASTER_SCALE = 3;
const DARK = 140;
const BOX_GLYPHS = /[☐□❑❒◻▢]/u;

type Run = { c: number; a: number; b: number };
type Group = { c1: number; c2: number; a: number; b: number };

/** Dark runs along rows (horizontal) or columns; 2px gaps allowed so underscores join up. */
function scanRuns(dark: Uint8Array, W: number, H: number, minLen: number, horizontal: boolean) {
  const runs: Run[] = [];
  const N = horizontal ? H : W;
  const M = horizontal ? W : H;
  for (let c = 0; c < N; c++) {
    let start = -1;
    let gap = 0;
    for (let a = 0; a <= M; a++) {
      const d = a < M && (horizontal ? dark[c * W + a] : dark[a * W + c]);
      if (d) {
        if (start < 0) start = a;
        gap = 0;
      } else if (start >= 0 && (++gap > 2 || a === M)) {
        const end = a - gap;
        if (end - start + 1 >= minLen) runs.push({ c, a: start, b: end });
        start = -1;
        gap = 0;
      }
    }
  }
  return runs;
}

/** Stacks overlapping runs in adjacent rows; keeps only thin results (rules, not text or fills). */
function groupRuns(runs: Run[], maxThick: number) {
  const open: Group[] = [];
  const done: Group[] = [];
  for (const r of runs) {
    const g = open.find(
      (g) =>
        g.c2 === r.c - 1 &&
        Math.min(g.b, r.b) - Math.max(g.a, r.a) > 0.8 * Math.min(g.b - g.a, r.b - r.a),
    );
    if (g) {
      g.c2 = r.c;
      g.a = Math.min(g.a, r.a);
      g.b = Math.max(g.b, r.b);
    } else open.push({ c1: r.c, c2: r.c, a: r.a, b: r.b });
    for (let i = open.length - 1; i >= 0; i--) {
      if ((open[i]?.c2 ?? 0) < r.c - 1) done.push(...open.splice(i, 1));
    }
  }
  done.push(...open);
  return done.filter((g) => g.c2 - g.c1 + 1 <= maxThick);
}

const overlapX = (a: { x: number; w: number }, b: { x: number; w: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const overlapY = (a: { y: number; h: number }, b: { y: number; h: number }) =>
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

/**
 * Rules, underscore runs and checkbox squares, found on the raster so every way of drawing them
 * (stroked paths, thin filled rects, "____" text, ☐ glyphs) looks the same.
 */
export async function pageGeometry(
  page: PdfjsPage,
  viewport: PdfjsViewport,
): Promise<PageGeometry> {
  const text = await pageText(page, viewport);
  const canvas = await renderPage(page, RASTER_SCALE);
  const { width: W, height: H } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const lum =
      0.299 * (px[i * 4] ?? 255) + 0.587 * (px[i * 4 + 1] ?? 255) + 0.114 * (px[i * 4 + 2] ?? 255);
    dark[i] = lum < DARK ? 1 : 0;
  }
  const S = RASTER_SCALE;
  const toBox = (g: Group, horizontal: boolean): Box =>
    horizontal
      ? { x: g.a / S, w: (g.b + 1 - g.a) / S, y: g.c1 / S, h: (g.c2 + 1 - g.c1) / S }
      : { y: g.a / S, h: (g.b + 1 - g.a) / S, x: g.c1 / S, w: (g.c2 + 1 - g.c1) / S };
  const h = groupRuns(scanRuns(dark, W, H, 6 * S, true), 3 * S).map((g) => toBox(g, true));
  const v = groupRuns(scanRuns(dark, W, H, 6 * S, false), 3 * S).map((g) => toBox(g, false));

  // Glyph strokes (serif feet along a baseline, letter stems) look like short rules. Drop runs
  // lying within a text item, unless it is a "____" or ☐ item.
  const insideText = (r: Box) =>
    text.some((t) => {
      if (t.str.includes("_") || BOX_GLYPHS.test(t.str)) return false;
      const ox = Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x);
      const along = r.w >= r.h ? r.w : r.h;
      const cy = r.y + r.h / 2;
      return (
        ox > 0.9 * Math.min(along, r.w) && cy >= t.y - 0.5 && cy <= t.baseline + 0.12 * t.fontH
      );
    });
  const hAll = h.filter((r) => !insideText(r));
  const vLines = v.filter((r) => !insideText(r));

  // Squares: two short horizontal runs, one above the other as far apart as they are long, with
  // vertical sides. Unfiltered runs, so ☐ drawn by a symbol font (Wingdings "q") count.
  const squares: Box[] = [];
  const hasSide = (x: number, y: number, hh: number) =>
    v.some((s) => Math.abs(s.x + s.w / 2 - x) < 1.5 && overlapY(s, { y, h: hh }) > 0.7 * hh);
  for (const top of h) {
    if (top.w > 20) continue;
    const bottom = h.find(
      (b) =>
        b !== top &&
        Math.abs(b.x - top.x) < 1.5 &&
        Math.abs(b.w - top.w) < 1.5 &&
        Math.abs(b.y - top.y - top.w) < Math.max(2, 0.25 * top.w),
    );
    if (
      bottom &&
      hasSide(top.x + 0.3, top.y, bottom.y - top.y) &&
      hasSide(top.x + top.w - 0.3, top.y, bottom.y - top.y) &&
      !squares.some((s) => Math.abs(s.x - top.x) < 2 && Math.abs(s.y - top.y) < 2)
    ) {
      squares.push({ x: top.x, y: top.y, w: top.w, h: bottom.y + bottom.h - top.y });
    }
  }
  const inSquare = (l: Box) =>
    squares.some(
      (s) => l.w <= s.w + 2 && l.x >= s.x - 1.5 && l.y >= s.y - 2 && l.y <= s.y + s.h + 2,
    );
  const hLines = hAll.filter((l) => l.w >= 10 && !inSquare(l));
  return { hLines, vLines, squares, text };
}

const closest = <T>(items: T[], distance: (item: T) => number) =>
  items.reduce<{ item: T; d: number } | undefined>((best, item) => {
    const d = distance(item);
    return !best || d < best.d ? { item, d } : best;
  }, undefined)?.item;

/**
 * Snaps an approximate vision box onto the page geometry. `anchored` says whether any edge found
 * a rule to sit on; unanchored boxes are the model's guess.
 */
export function snapBox(b: Box, type: string, geo: PageGeometry): Box & { anchored: boolean } {
  if (type === "checkbox") {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const near = (s: Box) => Math.hypot(s.x + s.w / 2 - cx, s.y + s.h / 2 - cy);
    const square = closest(
      geo.squares.filter((s) => near(s) < Math.max(8, s.w)),
      near,
    );
    return square ? { ...square, anchored: true } : { ...b, anchored: false };
  }
  let { x, y } = b;
  let x2 = b.x + b.w;
  let y2 = b.y + b.h;
  const tolY = Math.max(5, Math.min(10, b.h * 0.5));
  const tolX = 8;

  // Bottom onto the rule under the box. Vision boxes float above their line more often than
  // they sink below it, so search further down than up.
  const bottom = closest(
    geo.hLines.filter(
      (l) =>
        overlapX(l, { x, w: b.w }) > 0.3 * Math.min(b.w, l.w) && l.y - y2 <= 16 && y2 - l.y <= tolY,
    ),
    (l) => Math.abs(l.y - y2),
  );
  if (bottom) {
    y2 = bottom.y;
    if (Math.abs(bottom.x - x) <= tolX) x = bottom.x;
    if (Math.abs(bottom.x + bottom.w - x2) <= tolX) x2 = bottom.x + bottom.w;
  }
  // Top onto a rule just above (table cells, boxes).
  const top = closest(
    geo.hLines.filter(
      (l) =>
        l !== bottom &&
        overlapX(l, { x, w: x2 - x }) > 0.3 * Math.min(x2 - x, l.w) &&
        Math.abs(l.y + l.h - y) <= tolY &&
        l.y + l.h < y2 - 6,
    ),
    (l) => Math.abs(l.y + l.h - y),
  );
  if (top) y = top.y + top.h;
  // Sides onto vertical rules spanning the box.
  const span = { y, h: y2 - y };
  const side = (edge: number) =>
    closest(
      geo.vLines.filter(
        (l) => overlapY(l, span) > 0.5 * span.h && Math.abs(l.x + l.w / 2 - edge) <= tolX,
      ),
      (l) => Math.abs(l.x - edge),
    );
  const L = side(x);
  const R = side(x2);
  if (L) x = L.x + L.w;
  if (R) x2 = R.x;
  // Keep printed labels (e.g. a caption in the top of a table cell) out of the box.
  const labels = geo.text.filter(
    (t) =>
      !t.str.includes("___") &&
      overlapX(t, { x, w: x2 - x }) > 2 &&
      t.baseline > y &&
      t.baseline < y + (y2 - y) * 0.6,
  );
  if (labels.length) y = Math.max(y, ...labels.map((t) => t.baseline + 0.25 * t.fontH));
  // A field on a line is one text line tall: up to 18pt, stopping under the text or rule above.
  if (bottom && !top && type !== "multiline") {
    const above = [
      ...geo.text
        .filter(
          (t) =>
            overlapX(t, { x: x + 2, w: x2 - x - 4 }) > 0 &&
            t.baseline < y2 - 5 &&
            !/^[_\s,.]+$/.test(t.str),
        )
        .map((t) => t.baseline + 0.25 * t.fontH),
      ...geo.hLines
        .filter((l) => l !== bottom && overlapX(l, { x, w: x2 - x }) > 0 && l.y < y2 - 2)
        .map((l) => l.y + l.h),
    ].filter((value) => value < y2);
    y = Math.max(y2 - 18, ...above);
  }
  if (y2 - y < 6) y = y2 - 9;
  return { x, y, w: x2 - x, h: y2 - y, anchored: Boolean(bottom || top || L || R) };
}

/** PDF user space (origin bottom-left, points), as boxes store it. */
export function toPdfRect(viewport: PdfjsViewport, b: Box) {
  const [ax = 0, ay = 0] = viewport.convertToPdfPoint(b.x, b.y);
  const [bx = 0, by = 0] = viewport.convertToPdfPoint(b.x + b.w, b.y + b.h);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    x: r(Math.min(ax, bx)),
    y: r(Math.min(ay, by)),
    width: r(Math.abs(bx - ax)),
    height: r(Math.abs(by - ay)),
  };
}
