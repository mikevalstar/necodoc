import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import fontkit, { type Font } from "@cantoo/fontkit";
import {
  degrees,
  PDFCheckBox,
  type PDFDocument,
  PDFDropdown,
  type PDFFont,
  type PDFImage,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFTextField,
  rgb,
} from "@cantoo/pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ASSET_ORIGIN,
  type BundledFont,
  type OverlayBox,
  type OverlayRect,
  type OverlayRenderRequest,
  type RenderTimings,
  type TextStyle,
} from "@necodoc/shared";
import bwipjs from "bwip-js/node";
import type { AssetLoader } from "./browser";
import { plainLiquid } from "./liquid";
import { loadSourcePdf } from "./pdf-source";

// Spec: docs/features/pdf-overlay-templates.md. ADR 0013: values are filled into the source's
// AcroForm fields by name, or drawn at each box with pdf-lib; codes come from bwip-js as PNG.
// Rects are user-space points; on rotated pages, text and images are turned to read upright.

const require = createRequire(import.meta.url);

/** Loads an overlay template's source PDF bytes by pdf_source id. */
export type SourceLoader = (sourceId: string) => Promise<Uint8Array | null>;

// ---------------------------------------------------------------------------------------------
// Fonts. Fontsource ships each bundled font as unicode-range subsets; a chain picks, per
// character, the first subset that has it. WOFF (not WOFF2): fontkit can't subset WOFF2 for
// embedding.

type Face = { bytes: Uint8Array; font: Font };

function openFace(bytes: Uint8Array): Face {
  const opened = fontkit.create(bytes);
  const font = "fonts" in opened ? opened.fonts[0] : opened;
  if (!font) throw new Error("The font file has no fonts in it");
  return { bytes, font };
}

const bundledFaces = new Map<BundledFont, Face[]>();
function bundledFontFaces(id: BundledFont): Face[] {
  const cached = bundledFaces.get(id);
  if (cached) return cached;
  const dir = join(dirname(require.resolve(`@fontsource/${id}`)), "files");
  const rank = (name: string) =>
    name.includes("-latin-400") ? 0 : name.includes("-latin-ext-400") ? 1 : 2;
  const faces = readdirSync(dir)
    .filter((name) => name.endsWith("-400-normal.woff"))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => openFace(new Uint8Array(readFileSync(join(dir, name)))));
  bundledFaces.set(id, faces);
  return faces;
}

/** Liberation Sans (with pdf.js) covers Latin, Greek and Cyrillic in one file: AcroForm text. */
const formFontBytes = () =>
  readFileSync(
    join(
      dirname(require.resolve("pdfjs-dist/package.json")),
      "standard_fonts/LiberationSans-Regular.ttf",
    ),
  );

class FontChain {
  private embedded = new Map<number, Promise<PDFFont>>();
  readonly missing = new Set<string>();
  /** Cap height and descent of the first face, in em. */
  readonly cap: number;
  readonly descent: number;

  constructor(
    private doc: PDFDocument,
    private faces: Face[],
  ) {
    const first = faces[0]?.font;
    if (!first) throw new Error("A font chain needs a face");
    this.cap = (first.capHeight || first.ascent * 0.7) / first.unitsPerEm;
    this.descent = -first.descent / first.unitsPerEm;
  }

  /** Splits text into runs of one face each; spaces stay with the run they're in. */
  runs(text: string) {
    const runs: { face: number; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      const last = runs.at(-1);
      if (last && (/\s/.test(ch) || this.faces[last.face]?.font.hasGlyphForCodePoint(cp))) {
        last.text += ch;
        continue;
      }
      let face = this.faces.findIndex((f) => f.font.hasGlyphForCodePoint(cp));
      if (face < 0) {
        if (!/\s/.test(ch)) this.missing.add(ch);
        face = 0;
      }
      if (last?.face === face) last.text += ch;
      else runs.push({ face, text: ch });
    }
    return runs;
  }

  private runWidth(face: number, text: string, size: number) {
    const font = this.faces[face]?.font;
    return font ? (font.layout(text).advanceWidth / font.unitsPerEm) * size : 0;
  }

  width(text: string, size: number) {
    return this.runs(text).reduce((sum, run) => sum + this.runWidth(run.face, run.text, size), 0);
  }

  private embed(face: number) {
    let font = this.embedded.get(face);
    if (!font) {
      font = this.doc.embedFont(this.faces[face]?.bytes ?? new Uint8Array(), { subset: true });
      this.embedded.set(face, font);
    }
    return font;
  }

  /** Draws one line with its baseline starting at local (u, v). */
  async draw(
    page: PDFPage,
    frame: Frame,
    text: string,
    u: number,
    v: number,
    size: number,
    color: string,
  ) {
    let at = u;
    for (const run of this.runs(text)) {
      const { x, y } = frame.at(at, v);
      page.drawText(run.text, {
        x,
        y,
        size,
        font: await this.embed(run.face),
        color: hexColor(color),
        rotate: degrees(frame.rotate),
      });
      at += this.runWidth(run.face, run.text, size);
    }
  }
}

const hexColor = (hex: string) =>
  rgb(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );

// ---------------------------------------------------------------------------------------------
// Geometry: a box as the reader sees it on a rotated page

type Frame = {
  /** Upright size, as the reader sees it. */
  width: number;
  height: number;
  /** Local upright coordinates (origin bottom-left as seen) to user space. */
  at: (u: number, v: number) => { x: number; y: number };
  /** Counter-clockwise degrees to draw text and images upright. */
  rotate: number;
};

function frameOf({ x, y, width, height }: OverlayRect, rotation: number): Frame {
  // /Rotate turns the page clockwise for display; local axes turn with it.
  const [ox, oy, ux, uy, vx, vy, w, h] =
    rotation === 90
      ? [x + width, y, 0, 1, -1, 0, height, width]
      : rotation === 180
        ? [x + width, y + height, -1, 0, 0, -1, width, height]
        : rotation === 270
          ? [x, y + height, 0, -1, 1, 0, height, width]
          : [x, y, 1, 0, 0, 1, width, height];
  return {
    width: w,
    height: h,
    at: (u, v) => ({ x: ox + u * ux + v * vx, y: oy + u * uy + v * vy }),
    rotate: rotation,
  };
}

// ---------------------------------------------------------------------------------------------
// Text layout

const LINE_GAP = 1.25;

/** Greedy word wrap; words longer than a line break by character. */
function wrap(chain: FontChain, text: string, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (chain.width(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const ch of word) {
        if (line && chain.width(line + ch, size) > width) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Drops characters from the end until the line fits. */
function cutToWidth(chain: FontChain, text: string, size: number, width: number) {
  let chars = Array.from(text);
  while (chars.length && chain.width(chars.join(""), size) > width) chars = chars.slice(0, -1);
  return chars.join("").trimEnd();
}

type Layout = { lines: string[]; size: number; cut: boolean };

function layoutText(
  chain: FontChain,
  text: string,
  style: TextStyle,
  frame: Frame,
  multiline: boolean,
): Layout {
  const pad = Math.min(2, frame.width * 0.05);
  const width = frame.width - 2 * pad;
  const lineEm = chain.cap + chain.descent;
  const layoutAt = (size: number) => {
    const lines = multiline ? wrap(chain, text, size, width) : [text.replace(/\s+/g, " ")];
    const tall = lineEm * size + (lines.length - 1) * size * LINE_GAP;
    const wide = Math.max(...lines.map((line) => chain.width(line, size)));
    return { lines, fits: wide <= width && tall <= frame.height };
  };
  let size = style.size;
  let laid = layoutAt(size);
  if (style.autoShrink) {
    while (!laid.fits && size - 0.5 >= style.minSize) {
      size -= 0.5;
      laid = layoutAt(size);
    }
  }
  if (laid.fits) return { lines: laid.lines, size, cut: false };
  // Past the minimum: cut what doesn't fit, and say so.
  const room = Math.max(1, Math.floor((frame.height - lineEm * size) / (size * LINE_GAP)) + 1);
  const lines = laid.lines
    .slice(0, multiline ? room : 1)
    .map((line) => cutToWidth(chain, line, size, width));
  return { lines, size, cut: true };
}

async function drawText(
  page: PDFPage,
  frame: Frame,
  chain: FontChain,
  layout: Layout,
  style: TextStyle,
) {
  const pad = Math.min(2, frame.width * 0.05);
  const { size, lines } = layout;
  const block = (chain.cap + chain.descent) * size + (lines.length - 1) * size * LINE_GAP;
  const top =
    style.valign === "top"
      ? frame.height - Math.min(1, frame.height * 0.05)
      : style.valign === "bottom"
        ? block + Math.min(1, frame.height * 0.05)
        : (frame.height + block) / 2;
  for (const [i, line] of lines.entries()) {
    const width = chain.width(line, size);
    const u =
      style.align === "center"
        ? (frame.width - width) / 2
        : style.align === "right"
          ? frame.width - pad - width
          : pad;
    const baseline = top - chain.cap * size - i * size * LINE_GAP;
    await chain.draw(page, frame, line, u, baseline, size, style.color);
  }
}

// ---------------------------------------------------------------------------------------------
// Marks, images and codes

function drawCheck(page: PDFPage, frame: Frame, box: Extract<OverlayBox, { type: "checkbox" }>) {
  const color = hexColor(box.color);
  const s = Math.min(frame.width, frame.height);
  const thickness = Math.max(0.8, s * 0.12);
  // A square centred in the box, inset a little.
  const u0 = (frame.width - s) / 2;
  const v0 = (frame.height - s) / 2;
  const p = (u: number, v: number) => frame.at(u0 + u * s, v0 + v * s);
  if (box.mark === "fill") {
    const { x, y } = p(0.2, 0.2);
    page.drawRectangle({
      x,
      y,
      width: s * 0.6,
      height: s * 0.6,
      color,
      rotate: degrees(frame.rotate),
    });
  } else if (box.mark === "cross") {
    page.drawLine({ start: p(0.2, 0.2), end: p(0.8, 0.8), thickness, color });
    page.drawLine({ start: p(0.2, 0.8), end: p(0.8, 0.2), thickness, color });
  } else {
    page.drawLine({ start: p(0.18, 0.5), end: p(0.42, 0.22), thickness, color });
    page.drawLine({ start: p(0.42, 0.22), end: p(0.84, 0.82), thickness, color });
  }
}

const DATA_URL = /^data:(image\/[\w.+-]+);base64,(.+)$/s;

/** A box's image value: a `data:` URL or an asset URL. PNG and JPEG embed as they are. */
async function imageBytes(value: string, loadAsset: AssetLoader) {
  const data = DATA_URL.exec(value);
  if (data?.[1] && data[2]) return { mimeType: data[1], bytes: Buffer.from(data[2], "base64") };
  if (value.startsWith(`${ASSET_ORIGIN}/`)) {
    const asset = await loadAsset(value.slice(ASSET_ORIGIN.length + 1));
    return asset ? { mimeType: asset.mimeType, bytes: asset.bytes } : null;
  }
  return null;
}

async function embedImage(
  doc: PDFDocument,
  { mimeType, bytes }: { mimeType: string; bytes: Uint8Array },
) {
  if (mimeType === "image/png") return doc.embedPng(bytes);
  if (mimeType === "image/jpeg") return doc.embedJpg(bytes);
  // WebP, SVG: decode and re-encode as PNG.
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(Math.max(1, image.width), Math.max(1, image.height));
  canvas.getContext("2d").drawImage(image, 0, 0);
  return doc.embedPng(canvas.toBuffer("image/png"));
}

/** Scaled to fit the box, centred. */
function drawImageIn(page: PDFPage, frame: Frame, image: PDFImage) {
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const { x, y } = frame.at((frame.width - width) / 2, (frame.height - height) / 2);
  page.drawImage(image, { x, y, width, height, rotate: degrees(frame.rotate) });
}

const TWO_D = new Set(["qrcode", "pdf417", "datamatrix"]);

// ---------------------------------------------------------------------------------------------
// AcroForm

const truthy = (value: string) =>
  !["", "false", "0", "no", "off", "nil", "null"].includes(value.trim().toLowerCase());

type Filled = "filled" | "draw";

/** Fills the AcroForm field a box maps to. "draw" when it can't, so the caller draws instead. */
async function fillField(
  doc: PDFDocument,
  box: OverlayBox,
  value: string,
  formFont: () => Promise<PDFFont>,
  warn: (message: string) => void,
): Promise<Filled> {
  const name = box.acroField ?? "";
  const field = doc.getForm().getFieldMaybe(name);
  if (!field) {
    warn(`form field "${name}" isn't in the PDF; drawn instead`);
    return "draw";
  }
  if (field instanceof PDFCheckBox) {
    if (truthy(value)) field.check();
    else field.uncheck();
    return "filled";
  }
  if (
    field instanceof PDFRadioGroup ||
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList
  ) {
    if (!value) {
      field.clear();
      return "filled";
    }
    const options = field.getOptions();
    if (!options.includes(value) && !(field instanceof PDFDropdown && field.isEditable())) {
      warn(`"${value}" isn't an option of form field "${name}" (${options.join(", ")})`);
      return "filled";
    }
    field.select(value);
    return "filled";
  }
  if (field instanceof PDFTextField) {
    const max = field.getMaxLength();
    if (max !== undefined && value.length > max) warn(`cut to the form field's ${max} characters`);
    field.setText(max === undefined ? value : value.slice(0, max));
    // Appearances in a Unicode font; pdf-lib's default Helvetica only covers WinAnsi.
    field.updateAppearances(await formFont());
    return "filled";
  }
  warn(
    `form field "${name}" can't take a value (it's a ${field.constructor.name.replace(/^PDF/, "")}); drawn instead`,
  );
  return "draw";
}

// ---------------------------------------------------------------------------------------------

/** What a warning says a box is: its form field, or the start of its expression. */
const boxName = (box: OverlayBox) => {
  const expression = box.value.trim().replace(/\s+/g, " ");
  return (
    box.acroField ??
    (expression.length > 40 ? `${expression.slice(0, 37)}...` : expression || box.type)
  );
};

/**
 * Fills an uploaded PDF from a template's boxes and data. Never throws for one bad box: it
 * records a warning and carries on, so a generation still produces a PDF.
 */
export async function renderOverlay(
  request: OverlayRenderRequest,
  loadSource: SourceLoader,
  loadAsset: AssetLoader,
) {
  const timings: RenderTimings = { liquidMs: 0, chromiumMs: 0, bandsMs: 0, stampMs: 0 };
  const warnings = new Set<string>();
  let started = performance.now();
  const lap = (key: keyof RenderTimings) => {
    const now = performance.now();
    timings[key] += Math.round(now - started);
    started = now;
  };

  const bytes = await loadSource(request.sourceId);
  if (!bytes) throw new Error("The template's PDF is missing");
  const doc = await loadSourcePdf(bytes);
  lap("stampMs");

  // Values first, so a Liquid error fails the render before any drawing.
  const values: string[] = [];
  for (const box of request.boxes) {
    values.push((await plainLiquid.parseAndRender(box.value, request.data)).trim());
  }
  lap("liquidMs");

  const pages = doc.getPages();
  const chains = new Map<string, FontChain>();
  const chainFor = async (font: TextStyle["font"], warn: (m: string) => void) => {
    const id = typeof font === "string" ? font : font.assetId;
    const cached = chains.get(id);
    if (cached) return cached;
    let faces = bundledFontFaces(typeof font === "string" ? font : "noto-sans");
    if (typeof font !== "string") {
      const asset = await loadAsset(font.assetId);
      if (!asset) warn("its font asset is missing; used Noto Sans");
      else if (asset.mimeType === "font/woff2")
        warn("WOFF2 fonts can't be embedded; used Noto Sans");
      else faces = [openFace(asset.bytes), ...faces];
    }
    const chain = new FontChain(doc, faces);
    chains.set(id, chain);
    return chain;
  };
  let formFont: Promise<PDFFont> | undefined;
  const getFormFont = () => {
    formFont ??= doc.embedFont(formFontBytes(), { subset: true });
    return formFont;
  };

  for (const [i, box] of request.boxes.entries()) {
    const value = values[i] ?? "";
    const warn = (message: string) => warnings.add(`Page ${box.page}, ${boxName(box)}: ${message}`);
    const page = pages[box.page - 1];
    if (!page) {
      warn(`the PDF has no page ${box.page}`);
      continue;
    }
    try {
      if (box.acroField && (await fillField(doc, box, value, getFormFont, warn)) === "filled")
        continue;
      if (!value) continue;
      const frame = frameOf(box.rect, ((page.getRotation().angle % 360) + 360) % 360);
      switch (box.type) {
        case "text":
        case "multiline":
        case "number":
        case "date": {
          const chain = await chainFor(box.style.font, warn);
          const layout = layoutText(chain, value, box.style, frame, box.type === "multiline");
          if (layout.cut) warn(`text cut to fit (at ${layout.size}pt)`);
          await drawText(page, frame, chain, layout, box.style);
          break;
        }
        case "checkbox":
          if (truthy(value)) drawCheck(page, frame, box);
          break;
        case "image":
        case "signature": {
          const image = await imageBytes(value, loadAsset);
          if (!image) {
            warn("the value isn't an image (a data: URL or asset URL)");
            break;
          }
          drawImageIn(page, frame, await embedImage(doc, image));
          break;
        }
        case "qrcode":
        case "barcode": {
          const bcid = box.type === "qrcode" ? "qrcode" : box.symbology;
          const png = await bwipjs.toBuffer({
            bcid,
            text: value,
            scale: 4,
            includetext: !TWO_D.has(bcid),
          });
          drawImageIn(page, frame, await doc.embedPng(png));
          break;
        }
      }
    } catch (error) {
      warn(`skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const chain of chains.values()) {
    if (chain.missing.size) {
      warnings.add(
        `No glyph for ${[...chain.missing].slice(0, 10).join(" ")}; drawn as a blank box`,
      );
    }
  }

  const form = doc.getForm();
  // Hybrid forms: Acrobat shows the XFA data, not the AcroForm values we just set.
  if (form.hasXFA()) form.deleteXFA();
  if (request.flatten) {
    try {
      form.flatten({ updateFieldAppearances: false });
    } catch (error) {
      warnings.add(
        `Couldn't flatten the form: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const pdf = new Uint8Array(await doc.save({ updateFieldAppearances: false }));
  lap("stampMs");
  return { pdf, pageCount: pages.length, timings, warnings: [...warnings] };
}
