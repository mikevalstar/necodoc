import { ASSET_ORIGIN } from "@necodoc/shared";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { limiter } from "../limiter";

// ADR 0012: one shared Chromium, locked-down contexts, no network. ADR 0047: warm pages reused
// across renders.

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
/** Printers waiting for their next render; never more than `renderLimits.maxConcurrent`. */
let idle: Printer[] = [];

function sharedBrowser() {
  if (!browser) {
    // Idle printers belong to the old browser.
    idle = [];
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
  idle = [];
  await (await current)?.close();
}

/** Renders running at once across this process; each holds one printer. */
const withSlot = limiter(() => renderLimits.maxConcurrent);

/** Prints one HTML document to PDF on the render's page. */
export type Print = (html: string, options: PrintOptions) => Promise<Uint8Array<ArrayBuffer>>;

/** A printer is retired after this many renders, so a long-lived renderer can't creep in memory. */
const RENDERS_PER_PRINTER = 100;

/** A locked-down context and page, kept between renders (ADR 0047). */
type Printer = { context: BrowserContext; page: Page; renders: number; loadAsset: AssetLoader };

async function newPrinter(): Promise<Printer> {
  const context = await (await sharedBrowser()).newContext({ javaScriptEnabled: false });
  const printer: Printer = {
    context,
    page: await context.newPage(),
    renders: 0,
    loadAsset: async () => null,
  };
  // Every request but the asset origin is refused; assets come from the current render's loader.
  // Routing also turns off Chromium's HTTP cache, so no render reads another's asset bytes.
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.startsWith(`${ASSET_ORIGIN}/`)) return route.abort("blockedbyclient");
    const file = await printer.loadAsset(decodeURIComponent(url.slice(ASSET_ORIGIN.length + 1)));
    if (!file) return route.fulfill({ status: 404 });
    return route.fulfill({
      status: 200,
      contentType: file.mimeType,
      body: Buffer.from(file.bytes),
      // Fonts load cross-origin from the about:blank document.
      headers: { "access-control-allow-origin": "*" },
    });
  });
  return printer;
}

/**
 * Runs one render on a warm printer (ADR 0047): a new page starts a Chromium renderer process,
 * which costs more than printing a short document, so pages are reused. The render's prints
 * (body, then bands) take turns on the page. A render that fails or times out closes its printer;
 * a clean one blanks the page and hands it to the next render.
 */
export function withPrinter<T>(loadAsset: AssetLoader, fn: (print: Print) => Promise<T>) {
  return withSlot(async () => {
    const printer = idle.pop() ?? (await newPrinter());
    printer.loadAsset = loadAsset;
    printer.renders++;
    const { page } = printer;
    let timer: NodeJS.Timeout | undefined;
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
    const discard = () => printer.context.close().catch(() => {});
    let result: T;
    try {
      // Closing the printer on timeout also unblocks whatever Chromium was stuck on.
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Render timed out")), renderLimits.timeoutMs);
      });
      result = await Promise.race([fn(print), timedOut]);
    } catch (err) {
      await discard();
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (printer.renders >= RENDERS_PER_PRINTER) await discard();
    else {
      // Drop the last document before the page waits for the next render.
      printer.loadAsset = async () => null;
      await previous
        .then(() => page.setContent("", { timeout: renderLimits.timeoutMs }))
        .then(() => idle.push(printer), discard);
    }
    return result;
  });
}
