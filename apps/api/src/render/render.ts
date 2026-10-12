import { readFile } from "node:fs/promises";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  type RenderRequest,
  type RenderTimings,
  type SigningPackage,
  stringsFor,
} from "@necodoc/shared";
import { withSpan } from "../observability/tracing";
import { bandBody, bandCss, stampBand } from "./bands";
import { type AssetLoader, withPrinter } from "./browser";
import { bundledFontFiles, htmlDocument, themeCss } from "./document";
import { createLiquid, partialsFs } from "./liquid";
import { pageLayout } from "./page";
import { locateSignBoxes, markSignBoxes, signingCss, signingPackage } from "./signing";

export type RenderJob = Pick<
  RenderRequest,
  | "html"
  | "css"
  | "header"
  | "footer"
  | "page"
  | "data"
  | "partials"
  | "signers"
  | "signing"
  | "output"
  | "translations"
> & {
  /** The theme, already resolved from an id or a draft. */
  theme?: NonNullable<RenderRequest["themeDraft"]>;
};

/** Runs `fn` in a span (ADR 0036), adding its wall time to `timings[key]`. */
async function timed<T>(timings: RenderTimings, key: keyof RenderTimings, fn: () => Promise<T>) {
  const started = performance.now();
  try {
    return await withSpan(`render.${key.replace(/Ms$/, "")}`, {}, fn);
  } finally {
    timings[key] += Math.round(performance.now() - started);
  }
}

/**
 * HTML + Liquid to PDF in at most three Chromium passes on one page: the body, then one
 * multi-page PDF per band, stamped onto the body pages with pdf-lib (ADR 0012). Reports where the time went. With
 * signers or sign boxes, also returns the signing package (ADR 0033); dropping its anchors costs
 * one more body pass.
 */
export async function renderPdf(job: RenderJob, loadStoredAsset: AssetLoader) {
  const timings: RenderTimings = {
    liquidMs: 0,
    chromiumMs: 0,
    bandsMs: 0,
    stampMs: 0,
    finishMs: 0,
  };
  const loadAsset: AssetLoader = async (path) => {
    const fontFile = bundledFontFiles.get(path);
    if (fontFile) return { bytes: await readFile(fontFile), mimeType: "font/woff2" };
    return path.startsWith("fonts/") ? null : loadStoredAsset(path);
  };
  const { page, header, footer, data } = job;
  const layout = pageLayout(page, header, footer);
  const css = [job.theme ? themeCss(job.theme.settings, job.theme.css) : "", job.css ?? ""];

  // Snippets come from memory; `globals` lets them see the data, since {% render %} doesn't.
  // The document language picks formatting and translations (ADR 0040).
  const lang = job.output?.lang ?? "en";
  const liquid = createLiquid(partialsFs(job.partials), {
    lang,
    strings: stringsFor(job.translations, lang),
  });
  const body = await timed(timings, "liquidMs", () =>
    liquid.parseAndRender(job.html, data, { globals: data }),
  );
  return withPrinter(loadAsset, async (print) => {
    const sign = markSignBoxes(body);
    const tagged = job.output?.pdfua ?? false;
    const printBody = (html: string) =>
      timed(timings, "chromiumMs", () =>
        print(htmlDocument({ body: html, css: [...css, signingCss], lang }), {
          width: layout.width,
          height: layout.height,
          margins: layout.bodyMargins,
          tagged,
        }),
      );
    let bodyPdf = await printBody(sign.html);
    let signing: SigningPackage | undefined;
    if (sign.marks.length || job.signers?.length) {
      const anchors = job.signing?.anchors ?? true;
      const located = await timed(timings, "stampMs", () =>
        locateSignBoxes(bodyPdf, sign.marks, anchors),
      );
      // Anchors are absolutely positioned, so the boxes stay where they were found.
      if (!anchors && sign.marks.length) bodyPdf = await printBody(sign.plain);
      signing = await signingPackage(job.signers ?? [], data, located, anchors, [
        ...sign.warnings,
        ...located.warnings,
      ]);
    }
    const doc = await timed(timings, "stampMs", () => PDFDocument.load(bodyPdf));
    const pages = doc.getPageCount();

    // Bands take turns on the page; stamping mutates the body, so it runs in order.
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
          pdf: await print(
            htmlDocument({
              body: await bandBody(liquid, band, pages, data),
              css: [...css, bandCss(band)],
              lang,
            }),
            {
              width: layout.width,
              height: band.height,
              margins: { top: 0, bottom: 0, left: page.margins.left, right: page.margins.right },
            },
          ),
        })),
      ),
    );
    const pdf = await timed(timings, "stampMs", async () => {
      if (!bands.length) return bodyPdf;
      for (const { at, pdf } of printed) await stampBand(doc, pdf, at);
      return new Uint8Array(await doc.save());
    });

    return { pdf, pageCount: pages, timings, signing };
  });
}
