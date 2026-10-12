import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { ASSET_ORIGIN, type Strings, translate } from "@necodoc/shared";
import bwipjs from "bwip-js/node";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { type FS, Liquid } from "liquidjs";

// ADR 0015: one Liquid engine for templates, bands and API HTML. Escapes output by default
// (`| raw` opts out), errors on unknown filters, and reads only own properties of the data.
// ADR 0040: an engine is built per render for its document language, which drives formatting
// and the `t` filter.

dayjs.extend(localizedFormat);

const require = createRequire(import.meta.url);
const dayjsLocales = new Set(
  readdirSync(dirname(require.resolve("dayjs/locale/fr.js")))
    .filter((file) => file.endsWith(".js"))
    .map((file) => file.slice(0, -3)),
);

/**
 * The dayjs locale for a language tag, loaded on first use: the exact tag (`fr-ca`), then
 * language and region (`zh-tw` for `zh-Hant-TW`), then the language (`fr`), else `en`.
 */
export function dayjsLocale(lang: string) {
  const parts = lang.toLowerCase().split("-");
  const language = parts[0] ?? "";
  const region = parts.slice(1).findLast((part) => part.length === 2);
  const name = [parts.join("-"), region ? `${language}-${region}` : "", language].find((n) =>
    dayjsLocales.has(n),
  );
  if (!name) return "en";
  // The locale files register themselves on the dayjs they require, the same instance as ours.
  require(`dayjs/locale/${name}.js`);
  return name;
}

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

export type LiquidOptions = {
  /** `false` is for PDF overlays: their values are drawn as text, not parsed as HTML. */
  escapeHtml?: boolean;
  /** The document language (BCP 47): the default for `date`, `number` and `currency`. */
  lang?: string;
  /** What `t` looks up: the template's translations for `lang` (`stringsFor`). */
  strings?: Strings;
};

export function createLiquid(
  fs: FS = partialsFs(),
  { escapeHtml = true, lang = "en", strings = {} }: LiquidOptions = {},
) {
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
  // `LL` and friends are the language's own formats; a third argument picks another language.
  const dateLocale = dayjsLocale(lang);
  liquid.registerFilter("date", (value: unknown, format = "LL", locale?: string) => {
    if (value === null || value === undefined || value === "") return "";
    const date = value === "now" || value === "today" ? dayjs() : dayjs(String(value));
    if (!date.isValid()) throw new Error(`date: "${String(value)}" is not a date`);
    return date.locale(locale ? dayjsLocale(String(locale)) : dateLocale).format(String(format));
  });

  liquid.registerFilter("number", (value: unknown, decimals?: number, locale = lang) =>
    formatNumber(value, String(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  );

  liquid.registerFilter("currency", (value: unknown, currency = "USD", locale = lang) =>
    formatNumber(value, String(locale), { style: "currency", currency: String(currency) }),
  );

  liquid.registerFilter("qrcode", (value: unknown) => barcodeDataUrl("qrcode", value));
  liquid.registerFilter("barcode", (value: unknown, type = "code128") =>
    barcodeDataUrl(String(type), value),
  );

  liquid.registerFilter("t", (value: unknown) =>
    value === null || value === undefined ? "" : translate(strings, String(value)),
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
