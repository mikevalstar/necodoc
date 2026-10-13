import type { PDFDocument } from "@cantoo/pdf-lib";
import {
  displayedRect,
  displayedSize,
  type OverlayBox,
  type ResolvedSigner,
  type Signer,
  type SigningBox,
  type SigningKind,
  type SigningPackage,
  signingKindSchema,
} from "@necodoc/shared";
import { plainLiquid } from "./liquid";
import { openPdfjs } from "./pdfjs";

// Spec: docs/features/signing-packages.md. ADR 0033: rendered HTML sign boxes carry two invisible
// tokens, at their top-left and bottom-right corners; after printing, pdf.js finds the tokens in
// the text layer and the box is the rectangle between them. Renders run without JavaScript, so
// this is how we learn where Chromium put things. Overlay boxes already have their rects.

/** A `data-sign` element found in the rendered body, numbered in document order from 1. */
export type SignMark = { n: number; signerId: string; kind: SigningKind; required: boolean };

/** The start token doubles as the box's anchor string for DocuSign anchor tabs. */
export const anchorToken = (n: number) => `~sig${n}~`;
const endToken = (n: number) => `~end${n}~`;
const TOKEN = /~(sig|end)(\d+)~/g;

/**
 * Sign boxes get their layout here; the anchors are 1px monospace text at 1% alpha, which prints
 * nothing visible. Not fully transparent: Chromium on Linux drops `color: transparent` text from
 * the PDF (macOS keeps it), and everywhere drops `opacity: 0`. Absolutely positioned, so they never
 * move anything: printing with or without them gives the same layout.
 */
export const signingCss = `[data-sign] { display: inline-block; position: relative; vertical-align: bottom; break-inside: avoid; }
.necodoc-anchor { position: absolute; font: 1px/1px "JetBrains Mono", monospace; letter-spacing: 0; white-space: nowrap; color: rgb(0 0 0 / 1%); }
.necodoc-anchor-start { left: 0; top: 0; } .necodoc-anchor-end { right: 0; bottom: 0; }`;

/** Opening tags with a `data-sign` attribute. Attribute values containing `>` aren't supported. */
const SIGN_TAG = /<([a-z][\w-]*)(\s[^>]*?\bdata-sign\s*=[^>]*)>/gi;

function attribute(attrs: string, name: string) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/**
 * Gives a sign box an image role and a label, unless it has a role already. Tagged PDFs (PDF/UA,
 * ADR 0037) then hold it as a described Figure: its border is tagged (Chromium leaves an empty
 * box's border untagged), and screen readers say "signature for principal" instead of the tokens.
 */
function labelled(tag: string, attrs: string, kind: string, signerId: string) {
  if (attribute(attrs, "role") !== null) return tag;
  const label = `${kind.replace(/_/g, " ")} for ${signerId}`.replace(/[^\w ]/g, "");
  return tag.replace(/\s*\/?>$/, ` role="img" aria-label="${label}">`);
}

/**
 * Puts anchor tokens inside every `data-sign` element of rendered HTML. Returns the marked HTML,
 * the HTML without tokens (`plain`, for `anchors: false`), both with labelled boxes, and what each
 * box is; elements with an unknown kind or no signer are left alone, with a warning.
 */
export function markSignBoxes(html: string) {
  const marks: SignMark[] = [];
  const warnings: string[] = [];
  const plain: string[] = [];
  let last = 0;
  const marked = html.replace(SIGN_TAG, (tag, _name: string, attrs: string, offset: number) => {
    const kind = signingKindSchema.safeParse(attribute(attrs, "data-sign"));
    const signerId = attribute(attrs, "data-signer")?.trim();
    if (!kind.success || !signerId) {
      warnings.push(
        `A sign box ${kind.success ? "has no data-signer" : `has an unknown kind "${attribute(attrs, "data-sign")}"`}; skipped`,
      );
      return tag;
    }
    const n = marks.length + 1;
    marks.push({ n, signerId, kind: kind.data, required: !/\sdata-sign-optional\b/i.test(attrs) });
    const box = labelled(tag, attrs, kind.data, signerId);
    plain.push(html.slice(last, offset), box);
    last = offset + tag.length;
    return `${box}<span class="necodoc-anchor necodoc-anchor-start">${anchorToken(n)}</span><span class="necodoc-anchor necodoc-anchor-end">${endToken(n)}</span>`;
  });
  plain.push(html.slice(last));
  return { html: marked, plain: plain.join(""), marks, warnings };
}

type PageView = Parameters<typeof displayedRect>[1];
const quarterTurn = (degrees: number) => (((degrees % 360) + 360) % 360) as PageView["rotate"];

/** Where the anchor's line box starts, as a fraction of the font size above the baseline. */
const ASCENT = 0.86;

type Corner = { page: number; x: number; y: number };

/**
 * Finds every box's tokens in a printed PDF and turns them into rects. Boxes whose tokens are
 * missing (clipped, inside a band) or split over two pages are left out, with a warning.
 */
export async function locateSignBoxes(
  pdf: Uint8Array,
  marks: readonly SignMark[],
  anchors: boolean,
) {
  const doc = await openPdfjs(pdf);
  const starts = new Map<number, Corner>();
  const ends = new Map<number, Corner>();
  const pages: SigningPackage["pages"] = [];
  const views: PageView[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
      const view: PageView = { view: [x1, y1, x2, y2], rotate: quarterTurn(page.rotate) };
      views.push(view);
      pages.push(displayedSize(view));
      const text = await page.getTextContent();
      for (const item of text.items) {
        if (!("str" in item) || !item.str.includes("~")) continue;
        const [, , , size = 0, e = 0, f = 0] = item.transform as number[];
        const chars = [...item.str].length;
        for (const m of item.str.matchAll(TOKEN)) {
          // Monospace and one font per item, so characters share the item's width evenly.
          const before = [...item.str.slice(0, m.index)].length;
          const n = Number(m[2]);
          if (m[1] === "sig") {
            starts.set(n, { page: p, x: e + (item.width * before) / chars, y: f + ASCENT * size });
          } else {
            const after = before + m[0].length;
            ends.set(n, {
              page: p,
              x: e + (item.width * after) / chars,
              y: f - (1 - ASCENT) * size,
            });
          }
        }
      }
    }
  } finally {
    await doc.loadingTask.destroy();
  }

  const boxes: SigningBox[] = [];
  const warnings: string[] = [];
  for (const mark of marks) {
    const start = starts.get(mark.n);
    const end = ends.get(mark.n);
    const view = start && views[start.page - 1];
    if (!start || !end || !view) {
      warnings.push(`Sign box ${mark.n} (${mark.signerId}) wasn't found in the PDF; left out`);
      continue;
    }
    if (start.page !== end.page) {
      warnings.push(`Sign box ${mark.n} (${mark.signerId}) breaks across pages; left out`);
      continue;
    }
    const rect = {
      x: start.x,
      y: end.y,
      width: Math.max(0, end.x - start.x),
      height: Math.max(0, start.y - end.y),
    };
    boxes.push({
      id: `s${mark.n}`,
      signerId: mark.signerId,
      kind: mark.kind,
      required: mark.required,
      page: start.page,
      rect: roundRect(rect),
      ...roundedDisplay(rect, view),
      anchorString: anchors ? anchorToken(mark.n) : null,
    });
  }
  return { boxes, pages, warnings };
}

/** Overlay signature boxes that name a signer, at their own rects. */
export function overlaySignBoxes(doc: PDFDocument, boxes: readonly OverlayBox[]) {
  const pages = doc.getPages().map((page): PageView => {
    const crop = page.getCropBox();
    return {
      view: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
      rotate: quarterTurn(page.getRotation().angle),
    };
  });
  const found: SigningBox[] = [];
  for (const box of boxes) {
    if (box.type !== "signature" || !box.signerId) continue;
    const view = pages[box.page - 1];
    if (!view) continue;
    found.push({
      id: box.id,
      signerId: box.signerId,
      kind: box.signingKind ?? "signature",
      required: box.required ?? true,
      page: box.page,
      rect: roundRect(box.rect),
      ...roundedDisplay(box.rect, view),
      anchorString: null,
    });
  }
  return { boxes: found, pages: pages.map(displayedSize) };
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const roundRect = (r: SigningBox["rect"], places = 2) => ({
  x: round(r.x, places),
  y: round(r.y, places),
  width: round(r.width, places),
  height: round(r.height, places),
});
function roundedDisplay(rect: SigningBox["rect"], view: PageView) {
  const { topLeft, normalized } = displayedRect(rect, view);
  return { topLeft: roundRect(topLeft), normalized: roundRect(normalized, 5) };
}

/**
 * The package: signers with name and email rendered from the data, plus the located boxes. A box
 * for a signer nobody declared adds that signer, with its id as the role.
 */
export async function signingPackage(
  declared: readonly Signer[],
  data: Record<string, unknown>,
  located: Pick<SigningPackage, "boxes" | "pages">,
  anchors: boolean,
  warnings: readonly string[],
): Promise<SigningPackage> {
  const render = async (source: string) =>
    (await plainLiquid.parseAndRender(source, data, { globals: data })).trim();
  const signers: ResolvedSigner[] = [];
  for (const signer of declared) {
    signers.push({ ...signer, name: await render(signer.name), email: await render(signer.email) });
  }
  const all = [...warnings];
  for (const id of new Set(located.boxes.map((box) => box.signerId))) {
    if (signers.some((s) => s.id === id)) continue;
    all.push(`Sign boxes name "${id}", which isn't a declared signer; added with no name or email`);
    signers.push({ id, role: id, routingOrder: 1, name: "", email: "" });
  }
  return { signers, ...located, anchors, warnings: all };
}
