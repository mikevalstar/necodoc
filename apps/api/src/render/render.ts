import { readFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { RenderRequest, RenderTimings } from "@necodoc/shared";
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

/** Runs `fn`, adding its wall time to `timings[key]`. */
async function timed<T>(timings: RenderTimings, key: keyof RenderTimings, fn: () => Promise<T>) {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    timings[key] += Math.round(performance.now() - started);
  }
}

/**
 * HTML + Liquid to PDF in at most three Chromium passes: the body, then one multi-page PDF per
 * band, stamped onto the body pages with pdf-lib (ADR 0012). Reports where the time went.
 */
export async function renderPdf(job: RenderJob, loadStoredAsset: AssetLoader) {
  const timings: RenderTimings = { liquidMs: 0, chromiumMs: 0, bandsMs: 0, stampMs: 0 };
  const loadAsset: AssetLoader = async (path) => {
    const fontFile = bundledFontFiles.get(path);
    if (fontFile) return { bytes: await readFile(fontFile), mimeType: "font/woff2" };
    return path.startsWith("fonts/") ? null : loadStoredAsset(path);
  };
  const { page, header, footer, data } = job;
  const layout = pageLayout(page, header, footer);
  const css = [job.theme ? themeCss(job.theme.settings, job.theme.css) : "", job.css ?? ""];

  const body = await timed(timings, "liquidMs", () => liquid.parseAndRender(job.html, data));
  const bodyPdf = await timed(timings, "chromiumMs", () =>
    printPdf(
      htmlDocument({ body, css }),
      { width: layout.width, height: layout.height, margins: layout.bodyMargins },
      loadAsset,
    ),
  );
  const doc = await timed(timings, "stampMs", () => PDFDocument.load(bodyPdf));
  const pages = doc.getPageCount();

  // Bands print in parallel; stamping mutates the body, so it runs in order.
  const bands = (
    [
      { band: header, at: { edge: "top", offset: page.margins.top } },
      { band: footer, at: { edge: "bottom", offset: page.margins.bottom } },
    ] as const
  ).flatMap(({ band, at }) => (band ? [{ band, at }] : []));
  const printed = await timed(timings, "bandsMs", () =>
    Promise.all(
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
    ),
  );
  const pdf = await timed(timings, "stampMs", async () => {
    if (!bands.length) return bodyPdf;
    for (const { at, pdf } of printed) await stampBand(doc, pdf, at);
    return new Uint8Array(await doc.save());
  });

  return { pdf, pageCount: pages, timings };
}
