import { ASSET_ORIGIN } from "@necodoc/shared";
import bwipjs from "bwip-js/node";
import dayjs from "dayjs";
import { type FS, Liquid } from "liquidjs";

// ADR 0015: one Liquid engine for templates, bands and API HTML. Escapes output by default
// (`| raw` opts out), errors on unknown filters, and reads only own properties of the data.

/**
 * Partials from memory: snippets loaded by render/partials.ts (or frozen in a published version).
 * Nothing is read from disk.
 */
export function partialsFs(partials: Readonly<Record<string, string>> = {}): FS {
  const read = (file: string) => {
    const html = Object.hasOwn(partials, file) ? partials[file] : undefined;
    if (html === undefined) throw new Error(`Snippet "${file}" doesn't exist`);
    return html;
  };
  return {
    exists: async (file) => Object.hasOwn(partials, file),
    existsSync: (file) => Object.hasOwn(partials, file),
    readFile: async (file) => read(file),
    readFileSync: read,
    resolve: (_dir, file) => file,
  };
}

/** `escapeHtml: false` is for PDF overlays: their values are drawn as text, not parsed as HTML. */
export function createLiquid(fs: FS = partialsFs(), { escapeHtml = true } = {}) {
  const liquid = new Liquid({
    fs,
    relativeReference: false,
    ...(escapeHtml ? { outputEscape: "escape" as const } : {}),
    strictFilters: true,
    ownPropertyOnly: true,
    parseLimit: 1_000_000,
    renderLimit: 5_000,
    memoryLimit: 50_000_000,
  });

  // Replaces Liquid's strftime `date` with dayjs format tokens, like the app (src/lib/date.ts).
  liquid.registerFilter("date", (value: unknown, format = "MMMM D, YYYY") => {
    if (value === null || value === undefined || value === "") return "";
    const date = value === "now" || value === "today" ? dayjs() : dayjs(String(value));
    if (!date.isValid()) throw new Error(`date: "${String(value)}" is not a date`);
    return date.format(String(format));
  });

  liquid.registerFilter("number", (value: unknown, decimals?: number, locale = "en-US") =>
    formatNumber(value, String(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  );

  liquid.registerFilter("currency", (value: unknown, currency = "USD", locale = "en-US") =>
    formatNumber(value, String(locale), { style: "currency", currency: String(currency) }),
  );

  liquid.registerFilter("qrcode", (value: unknown) => barcodeDataUrl("qrcode", value));
  liquid.registerFilter("barcode", (value: unknown, type = "code128") =>
    barcodeDataUrl(String(type), value),
  );

  liquid.registerFilter("asset_url", (id: unknown) => `${ASSET_ORIGIN}/${String(id)}`);

  return liquid;
}

function formatNumber(value: unknown, locale: string, options: Intl.NumberFormatOptions) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (Number.isNaN(number)) throw new Error(`"${String(value)}" is not a number`);
  return new Intl.NumberFormat(locale, options).format(number);
}

/** SVG, so codes stay vector in the PDF. */
function barcodeDataUrl(bcid: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const svg = bwipjs.toSVG({ bcid, text: String(value), scale: 3, includetext: bcid !== "qrcode" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const liquid = createLiquid();
/** Overlay box values (docs/features/pdf-overlay-templates.md): same filters, no HTML escaping. */
export const plainLiquid = createLiquid(partialsFs(), { escapeHtml: false });
