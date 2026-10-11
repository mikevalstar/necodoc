import { readFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { RenderRequest } from "@necodoc/shared";
import { bandBody, bandCss, stampBand } from "./bands";
import { type AssetLoader, printPdf } from "./browser";
import { bundledFontFiles, htmlDocument, themeCss } from "./document";
import { liquid } from "./liquid";
import { pageLayout } from "./page";

export type RenderJob = Pick<
  RenderRequest,
  "html" | "css" | "header" | "footer" | "page" | "data"
> & {
  /** The theme, already resolved from an id or a draft. */
  theme?: NonNullable<RenderRequest["themeDraft"]>;
};

/**
 * HTML + Liquid to PDF in at most three Chromium passes: the body, then one multi-page PDF per
 * band, stamped onto the body pages with pdf-lib (ADR 0012).
 */
export async function renderPdf(job: RenderJob, loadStoredAsset: AssetLoader) {
  const loadAsset: AssetLoader = async (path) => {
    const fontFile = bundledFontFiles.get(path);
    if (fontFile) return { bytes: await readFile(fontFile), mimeType: "font/woff2" };
    return path.startsWith("fonts/") ? null : loadStoredAsset(path);
  };
  const { page, header, footer, data } = job;
  const layout = pageLayout(page, header, footer);
  const css = [job.theme ? themeCss(job.theme.settings, job.theme.css) : "", job.css ?? ""];

  const body = await liquid.parseAndRender(job.html, data);
  const bodyPdf = await printPdf(
    htmlDocument({ body, css }),
    { width: layout.width, height: layout.height, margins: layout.bodyMargins },
    loadAsset,
  );
  const doc = await PDFDocument.load(bodyPdf);
  const pages = doc.getPageCount();

  // Bands print in parallel; stamping mutates the body, so it runs in order.
  const bands = (
    [
      { band: header, at: { edge: "top", offset: page.margins.top } },
      { band: footer, at: { edge: "bottom", offset: page.margins.bottom } },
    ] as const
  ).flatMap(({ band, at }) => (band ? [{ band, at }] : []));
  const printed = await Promise.all(
    bands.map(async ({ band, at }) => ({
      at,
      pdf: await printPdf(
        htmlDocument({ body: await bandBody(band, pages, data), css: [...css, bandCss(band)] }),
        {
          width: layout.width,
          height: band.height,
          margins: { top: 0, bottom: 0, left: page.margins.left, right: page.margins.right },
        },
        loadAsset,
      ),
    })),
  );
  for (const { at, pdf } of printed) await stampBand(doc, pdf, at);

  return { pdf: bands.length ? new Uint8Array(await doc.save()) : bodyPdf, pageCount: pages };
}
