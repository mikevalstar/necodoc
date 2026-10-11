import { ASSET_ORIGIN } from "@necodoc/shared";
import { type Browser, chromium } from "playwright-core";
import { limiter } from "../limiter";

// ADR 0012: one shared Chromium, a fresh locked-down context per print, no network.

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

export async function closeBrowser() {
  const current = browser;
  browser = null;
  await (await current)?.close();
}

/** Chromium contexts open at once, across every render in this process. */
const withSlot = limiter(() => renderLimits.maxConcurrent);

/** Prints one HTML document to PDF. */
export function printPdf(html: string, options: PrintOptions, loadAsset: AssetLoader) {
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
      const print = async () => {
        await page.setContent(html, { waitUntil: "load", timeout: renderLimits.timeoutMs });
        const mm = (value: number) => `${value}mm`;
        return page.pdf({
          width: mm(options.width),
          height: mm(options.height),
          margin: {
            top: mm(options.margins.top),
            right: mm(options.margins.right),
            bottom: mm(options.margins.bottom),
            left: mm(options.margins.left),
          },
          printBackground: true,
        });
      };
      // Closing the context on timeout also unblocks whatever Chromium was stuck on.
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Render timed out")), renderLimits.timeoutMs);
      });
      return new Uint8Array(await Promise.race([print(), timedOut]));
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  });
}
