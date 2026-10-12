import { beginMarkedContent, endMarkedContent, PDFDocument } from "@cantoo/pdf-lib";
import type { Band } from "@necodoc/shared";
import type { Liquid } from "liquidjs";
import { MM_TO_PT } from "./page";

/**
 * The body of a band document: one fixed-height, clipped section per body page, with
 * `{{ page }}` / `{{ pages }}` set per page and the first-page variant on page 1 (ADR 0012).
 */
export async function bandBody(
  liquid: Liquid,
  band: Band,
  pages: number,
  data: Record<string, unknown>,
) {
  const main = liquid.parse(band.html);
  const first = band.firstPageHtml === undefined ? main : liquid.parse(band.firstPageHtml);
  const sections: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const scope = { ...data, page, pages };
    const html = await liquid.render(page === 1 ? first : main, scope, { globals: scope });
    sections.push(`<div class="necodoc-band">${html}</div>`);
  }
  return sections.join("");
}

/** Keeps each section to exactly one band-height page. */
export const bandCss = (band: Band) =>
  `.necodoc-band { height: ${band.height}mm; overflow: hidden; break-after: page; } .necodoc-band:last-child { break-after: auto; }`;

/**
 * Draws band page N onto body page N, `offset` millimetres in from the page's top or bottom
 * edge, as an artifact. Positions come from each page's real size: Chromium rounds page sizes by up to a point.
 */
export async function stampBand(
  body: PDFDocument,
  bandPdf: Uint8Array,
  { edge, offset }: { edge: "top" | "bottom"; offset: number },
) {
  const bandDoc = await PDFDocument.load(bandPdf);
  if (bandDoc.getPageCount() !== body.getPageCount()) {
    throw new Error(
      `Band rendered ${bandDoc.getPageCount()} pages for ${body.getPageCount()} body pages`,
    );
  }
  const embedded = await body.embedPdf(bandDoc, bandDoc.getPageIndices());
  embedded.forEach((bandPage, i) => {
    const page = body.getPage(i);
    const y =
      edge === "bottom"
        ? offset * MM_TO_PT
        : page.getHeight() - offset * MM_TO_PT - bandPage.height;
    // Headers and footers are pagination artifacts: outside the structure tree, so a tagged
    // body stays PDF/UA (ADR 0037). Untagged bodies ignore the marks.
    page.pushOperators(beginMarkedContent("Artifact"));
    page.drawPage(bandPage, { x: 0, y });
    page.pushOperators(endMarkedContent());
  });
}
