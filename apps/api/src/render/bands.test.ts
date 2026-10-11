import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { bandBody, stampBand } from "./bands";
import { liquid } from "./liquid";
import { MM_TO_PT } from "./page";

/** A PDF of `count` pages, each with "<label> N" at its bottom-left corner. */
async function labelledPdf(count: number, width: number, height: number, label: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) {
    doc.addPage([width, height]).drawText(`${label} ${i}`, { x: 0, y: 0, size: 8, font });
  }
  return doc;
}

/** Each page's text runs with their y position. */
async function textPositions(pdf: Uint8Array) {
  const doc = await getDocument({ data: pdf.slice() }).promise;
  const pages: { str: string; y: number }[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { items } = await (await doc.getPage(i)).getTextContent();
    pages.push(
      items.flatMap((item) => ("str" in item ? [{ str: item.str, y: item.transform[5] }] : [])),
    );
  }
  return pages;
}

describe("stampBand", () => {
  it("puts band page N on body page N at the right edge offset", async () => {
    const body = await labelledPdf(3, 612, 792, "Body");
    const header = await (await labelledPdf(3, 612, 20 * MM_TO_PT, "Header")).save();
    const footer = await (await labelledPdf(3, 612, 10 * MM_TO_PT, "Footer")).save();

    await stampBand(body, header, { edge: "top", offset: 15 });
    await stampBand(body, footer, { edge: "bottom", offset: 5 });

    const pages = await textPositions(await body.save());
    expect(pages).toHaveLength(3);
    pages.forEach((runs, i) => {
      const y = (str: string) => runs.find((run) => run.str === str)?.y;
      expect(y(`Header ${i + 1}`)).toBeCloseTo(792 - (15 + 20) * MM_TO_PT);
      expect(y(`Footer ${i + 1}`)).toBeCloseTo(5 * MM_TO_PT);
      expect(y(`Body ${i + 1}`)).toBe(0);
    });
  });

  it("refuses a band whose page count doesn't match the body", async () => {
    const body = await labelledPdf(2, 612, 792, "Body");
    const band = await (await labelledPdf(3, 612, 20, "Band")).save();
    await expect(stampBand(body, band, { edge: "top", offset: 0 })).rejects.toThrow(/3 pages/);
  });
});

describe("bandBody", () => {
  it("renders one section per page with page tokens and the first-page variant", async () => {
    const html = await bandBody(
      liquid,
      { html: "{{ page }}/{{ pages }} {{ who }}", firstPageHtml: "First {{ who }}", height: 10 },
      3,
      { who: "<Ann>" },
    );
    expect(html).toBe(
      [
        '<div class="necodoc-band">First &lt;Ann&gt;</div>',
        '<div class="necodoc-band">2/3 &lt;Ann&gt;</div>',
        '<div class="necodoc-band">3/3 &lt;Ann&gt;</div>',
      ].join(""),
    );
  });
});
