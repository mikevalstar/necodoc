import { ASSET_ORIGIN } from "@necodoc/shared";
import { type Browser, chromium } from "playwright-core";
import { limiter } from "../limiter";

// ADR 0012: one shared Chromium, a fresh locked-down context per render, no network.

/** Mutable so tests can shorten the timeout and the process can size the cap to its role. */
export const renderLimits = { maxConcurrent: 4, timeoutMs: 30_000 };

export type AssetFile = { bytes: Uint8Array; mimeType: string };
/** Resolves a path under the asset origin (an asset id or `fonts/...`) to its bytes. */
export type AssetLoader = (path: string) => Promise<AssetFile | null>;

export type PrintOptions = {
  /** Millimetres. */
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /** A tagged PDF with an outline from the headings, for PDF/UA (ADR 0037). */
  tagged?: boolean;
};

let browser: Promise<Browser> | null = null;

function sharedBrowser() {
  if (!browser) {
    const launching = chromium.launch();
    browser = launching;
    launching.then(
      (b) =>
        b.on("disconnected", () => {
          if (browser === launching) browser = null;
        }),
      () => {
        if (browser === launching) browser = null;
      },
    );
  }
  return browser;
}

/** The shared Chromium's version, starting it if it isn't running (Admin > System). */
export async function chromiumVersion() {
  return (await sharedBrowser()).version();
}

export async function closeBrowser() {
  const current = browser;
  browser = null;
  await (await current)?.close();
}

/** Renders (one context each) open at once, across this process. */
const withSlot = limiter(() => renderLimits.maxConcurrent);

/** Prints one HTML document to PDF on the render's page. */
export type Print = (html: string, options: PrintOptions) => Promise<Uint8Array<ArrayBuffer>>;

/**
 * Runs one render: a fresh locked-down context and page, closed when `fn` settles or the render
 * times out. Its prints (body, then bands) take turns on that page: a new page starts a Chromium
 * renderer process, which costs more than printing a short document.
 */
export function withPrinter<T>(loadAsset: AssetLoader, fn: (print: Print) => Promise<T>) {
  return withSlot(async () => {
    const context = await (await sharedBrowser()).newContext({ javaScriptEnabled: false });
    let timer: NodeJS.Timeout | undefined;
    try {
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (!url.startsWith(`${ASSET_ORIGIN}/`)) return route.abort("blockedbyclient");
        const file = await loadAsset(decodeURIComponent(url.slice(ASSET_ORIGIN.length + 1)));
        if (!file) return route.fulfill({ status: 404 });
        return route.fulfill({
          status: 200,
          contentType: file.mimeType,
          body: Buffer.from(file.bytes),
          // Fonts load cross-origin from the about:blank document.
          headers: { "access-control-allow-origin": "*" },
        });
      });
      const page = await context.newPage();
      let previous: Promise<unknown> = Promise.resolve();
      const print: Print = (html, options) => {
        const printed = previous.then(async () => {
          // No timeout of its own: the race below owns the deadline, so a slow render always
          // fails as "Render timed out" rather than whichever Playwright timer fires first.
          await page.setContent(html, { waitUntil: "load", timeout: 0 });
          // Fallback faces (Arabic, Hebrew: ADR 0040) only start loading once layout needs their
          // glyphs, which can be after `load`: lay out, then wait for every font in flight.
          await page.evaluate("document.body.offsetHeight, document.fonts.ready.then(() => {})");
          // Inches, not mm: Playwright's mm rounds Letter up to 612.96 x 792.96pt; inches give
          // exactly 612 x 792 (Chromium still snaps A4 to its pixel grid, under a point off).
          const inches = (mm: number) => `${mm / 25.4}in`;
          return new Uint8Array(
            await page.pdf({
              width: inches(options.width),
              height: inches(options.height),
              margin: {
                top: inches(options.margins.top),
                right: inches(options.margins.right),
                bottom: inches(options.margins.bottom),
                left: inches(options.margins.left),
              },
              printBackground: true,
              tagged: options.tagged ?? false,
              outline: options.tagged ?? false,
            }),
          );
        });
        previous = printed.catch(() => {});
        return printed;
      };
      // Closing the context on timeout also unblocks whatever Chromium was stuck on.
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Render timed out")), renderLimits.timeoutMs);
      });
      return await Promise.race([fn(print), timedOut]);
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  });
}
