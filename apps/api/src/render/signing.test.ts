import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { pageOptionsSchema, type SigningBox } from "@necodoc/shared";
import { afterAll, describe, expect, it } from "vitest";
import { renderPage } from "../detect/geometry";
import { pdfText } from "../visual-diff";
import { closeBrowser } from "./browser";
import { MM_TO_PT } from "./page";
import { openPdfjs } from "./pdfjs";
import { renderPdf } from "./render";
import { markSignBoxes } from "./signing";

// Real Chromium. Boxes are located from the PDF text layer, then checked against the pixels.

afterAll(closeBrowser);

const SCALE = 2;

/** Rasterises each page with the boxes drawn on it; SIGNING_DEBUG_DIR keeps the PNGs. */
async function rasterise(pdf: Uint8Array, boxes: readonly SigningBox[]) {
  const doc = await openPdfjs(pdf);
  const canvases: Canvas[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await renderPage(await doc.getPage(n), SCALE);
      const debug = createCanvas(page.width, page.height);
      const ctx = debug.getContext("2d");
      ctx.drawImage(page, 0, 0);
      ctx.strokeStyle = "#e00";
      for (const box of boxes.filter((b) => b.page === n)) {
        const { x, y, width, height } = box.topLeft;
        ctx.strokeRect(x * SCALE, y * SCALE, width * SCALE, height * SCALE);
      }
      const dir = process.env.SIGNING_DEBUG_DIR;
      if (dir) await writeFile(join(dir, `signing-${n}.png`), debug.toBuffer("image/png"));
      canvases.push(page);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return canvases;
}

/** Whether the pixel at a point (top-left, in points) is dark. */
function dark(canvas: Canvas | undefined, x: number, y: number) {
  if (!canvas) throw new Error("No such page");
  const [r = 255, g = 255, b = 255] = canvas
    .getContext("2d")
    .getImageData(Math.round(x * SCALE), Math.round(y * SCALE), 1, 1).data;
  return r + g + b < 200;
}

const box = (signer: string, kind: string, style = "", extra = "") =>
  `<span data-sign="${kind}" data-signer="${signer}"${extra} style="width:60mm;height:14mm;${style}"></span>`;

describe("markSignBoxes", () => {
  it("numbers boxes in order, reads optional, and skips bad ones with a warning", () => {
    const { html, marks, warnings } = markSignBoxes(
      `<p>${box("buyer", "signature")} <span data-sign='initials' data-signer=seller data-sign-optional></span> ${box("x", "stamp")} <span data-sign="text"></span></p>`,
    );
    expect(marks).toEqual([
      { n: 1, signerId: "buyer", kind: "signature", required: true },
      { n: 2, signerId: "seller", kind: "initials", required: false },
    ]);
    expect(warnings).toHaveLength(2);
    expect(html).toContain("~sig1~");
    expect(html).toContain("~end2~");
    expect(html).not.toContain("~sig3~");
  });
});

describe("sign boxes in rendered HTML", () => {
  const html = [
    `<p>Buyer: ${box("buyer", "signature", "background:#000")}</p>`,
    `<p>Date: ${box("buyer", "date_signed", "border-bottom:1px solid #000")}</p>`,
    '<div style="break-before:page"></div>',
    `<p style="margin-left:30mm">Seller: ${box("seller", "initials", "background:#000", " data-sign-optional")}</p>`,
  ].join("");
  const page = pageOptionsSchema.parse({ size: "Letter" });
  const signers = [
    { id: "buyer", role: "Buyer", routingOrder: 1, name: "{{ buyer_name }}", email: "b@x.test" },
  ];

  it("finds each box within a point of where it prints, on its page", async () => {
    const { pdf, signing } = await renderPdf(
      { html, page, data: { buyer_name: "Ada" }, signers },
      async () => null,
    );
    if (!signing) throw new Error("No signing package");
    expect(signing.warnings).toEqual([expect.stringContaining('"seller"')]);
    expect(signing.signers.map((s) => [s.id, s.name])).toEqual([
      ["buyer", "Ada"],
      ["seller", ""],
    ]);
    expect(signing.boxes.map((b) => [b.id, b.signerId, b.kind, b.page, b.required])).toEqual([
      ["s1", "buyer", "signature", 1, true],
      ["s2", "buyer", "date_signed", 1, true],
      ["s3", "seller", "initials", 2, false],
    ]);
    for (const b of signing.boxes) {
      expect(b.rect.width).toBeCloseTo(60 * MM_TO_PT, 0);
      expect(Math.abs(b.rect.height - 14 * MM_TO_PT)).toBeLessThan(1);
      expect(b.topLeft.y + b.topLeft.height).toBeCloseTo(
        (signing.pages[b.page - 1]?.height ?? 0) - b.rect.y,
        1,
      );
      expect(b.normalized.x).toBeCloseTo(b.topLeft.x / (signing.pages[0]?.width ?? 1), 4);
      expect(b.anchorString).toBe(`~sig${b.id.slice(1)}~`);
    }
    // The 30 mm left margin (less a shorter label) moved the seller's box right.
    const [first, , third] = signing.boxes;
    expect((third?.topLeft.x ?? 0) - (first?.topLeft.x ?? 0)).toBeGreaterThan(25 * MM_TO_PT);

    const pages = await rasterise(pdf, signing.boxes);
    for (const b of [first, third]) {
      if (!b) continue;
      const { x, y, width, height } = b.topLeft;
      const canvas = pages[b.page - 1];
      expect(dark(canvas, x + 2, y + 2)).toBe(true);
      expect(dark(canvas, x + width - 2, y + height - 2)).toBe(true);
      expect(dark(canvas, x - 2, y + height / 2)).toBe(false);
      expect(dark(canvas, x + width + 2, y + height / 2)).toBe(false);
      expect(dark(canvas, x + width / 2, y - 2)).toBe(false);
      expect(dark(canvas, x + width / 2, y + height + 2)).toBe(false);
    }
    // The anchors are in the text layer but print nothing: the date box is blank above its line.
    const date = signing.boxes[1];
    if (date) expect(dark(pages[0], date.topLeft.x + 1, date.topLeft.y + 1)).toBe(false);
    expect((await pdfText(pdf)).join(" ")).toContain("~sig1~");
  });

  it("re-prints without anchors at the same positions", async () => {
    const kept = await renderPdf({ html, page, data: {}, signers }, async () => null);
    const dropped = await renderPdf(
      { html, page, data: {}, signers, signing: { anchors: false } },
      async () => null,
    );
    expect(dropped.signing?.anchors).toBe(false);
    expect(dropped.signing?.boxes.map((b) => b.rect)).toEqual(kept.signing?.boxes.map((b) => b.rect));
    expect(dropped.signing?.boxes.every((b) => b.anchorString === null)).toBe(true);
    expect((await pdfText(dropped.pdf)).join(" ")).not.toMatch(/~(sig|end)\d+~/);
  });

  it("gives no package for HTML without signers or sign boxes", async () => {
    const { signing } = await renderPdf({ html: "<p>Hi</p>", page, data: {} }, async () => null);
    expect(signing).toBeUndefined();
  });
});
