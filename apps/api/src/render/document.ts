import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  ASSET_ORIGIN,
  type BundledFont,
  bundledFonts,
  type ThemeFont,
  type ThemeSettings,
  textDirection,
  themeFontAssetIds,
} from "@necodoc/shared";

// Turns a theme, user CSS and rendered HTML into one self-contained document for Chromium.

const require = createRequire(import.meta.url);

const fontPackages: Record<BundledFont, { pkg: string; faces: string[] }> = {
  "noto-sans": { pkg: "@fontsource/noto-sans", faces: ["400", "400-italic", "700", "700-italic"] },
  inter: { pkg: "@fontsource/inter", faces: ["400", "400-italic", "700", "700-italic"] },
  "noto-serif": {
    pkg: "@fontsource/noto-serif",
    faces: ["400", "400-italic", "700", "700-italic"],
  },
  "jetbrains-mono": { pkg: "@fontsource/jetbrains-mono", faces: ["400", "700"] },
};

/**
 * Scripts the theme fonts lack (ADR 0040), listed after every font so Chromium only uses them for
 * those glyphs. CJK isn't bundled: it falls back to the server's fonts.
 */
const scriptFallbacks = {
  "noto-sans-arabic": { pkg: "@fontsource/noto-sans-arabic", faces: ["arabic-400", "arabic-700"] },
  "noto-sans-hebrew": { pkg: "@fontsource/noto-sans-hebrew", faces: ["hebrew-400", "hebrew-700"] },
};
const FALLBACK_FAMILIES = '"Noto Sans Arabic", "Noto Sans Hebrew"';

/** Asset-origin path (`fonts/<id>/<file>`) to the bundled font file on disk. */
export const bundledFontFiles = new Map<string, string>();

// Fontsource's own @font-face rules (with unicode-range subsets), pointed at the asset origin.
// Chromium only fetches the subsets a document actually uses.
const bundledFontCss = [...Object.entries(fontPackages), ...Object.entries(scriptFallbacks)]
  .flatMap(([id, { pkg, faces }]) => {
    const dir = dirname(require.resolve(pkg));
    return faces.map((face) =>
      readFileSync(join(dir, `${face}.css`), "utf8").replace(
        /url\(\.\/files\/([\w.-]+\.woff2)\) format\('woff2'\)[^;]*;/g,
        (_match, fileName: string) => {
          bundledFontFiles.set(`fonts/${id}/${fileName}`, join(dir, "files", fileName));
          return `url(${ASSET_ORIGIN}/fonts/${id}/${fileName}) format('woff2');`;
        },
      ),
    );
  })
  .join("\n");

const fontFamily = (font: ThemeFont) =>
  typeof font === "string"
    ? `"${bundledFonts[font].family}", ${FALLBACK_FAMILIES}, ${bundledFonts[font].generic}`
    : `"asset-${font.assetId}", "Noto Sans", ${FALLBACK_FAMILIES}, sans-serif`;

export function themeCss(settings: ThemeSettings, css: string) {
  const s = settings;
  const assetFaces = themeFontAssetIds(s).map(
    (id) => `@font-face { font-family: "asset-${id}"; src: url(${ASSET_ORIGIN}/${id}); }`,
  );
  return `${assetFaces.join("\n")}
body { font-family: ${fontFamily(s.font)}; font-size: ${s.fontSize}pt; line-height: ${s.lineHeight}; color: ${s.textColor}; }
h1, h2, h3, h4, h5, h6 { font-family: ${fontFamily(s.headingFont)}; color: ${s.headingColor}; line-height: 1.2; }
h1 { font-size: ${s.h1Size}pt; }
h2 { font-size: ${s.h2Size}pt; }
h3 { font-size: ${s.h3Size}pt; }
a { color: ${s.linkColor}; }
hr { border: 0; border-top: 1px solid ${s.accentColor}; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid ${s.tableBorderColor}; padding: ${s.tableCellPadding}mm; text-align: start; vertical-align: top; }
th { background: ${s.tableHeaderBackground}; }
:is(th, td) > :first-child { margin-top: 0; }
:is(th, td) > :last-child { margin-bottom: 0; }
${css}`;
}

/**
 * A full HTML document: bundled fonts, then base styles, theme, user CSS, then the body. The
 * language sets `lang` and, for right-to-left languages, `dir` (ADR 0040).
 */
export function htmlDocument({
  body,
  css,
  lang = "en",
}: {
  body: string;
  css: string[];
  lang?: string;
}) {
  const styles = [
    bundledFontCss,
    `html, body { margin: 0; padding: 0; } body { font-family: "Noto Sans", ${FALLBACK_FAMILIES}, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
thead { display: table-header-group; } tr, img { break-inside: avoid; }`,
    ...css,
  ];
  return `<!doctype html><html lang="${lang}" dir="${textDirection(lang)}"><head><meta charset="utf-8">${styles.map((s) => `<style>${s}</style>`).join("")}</head><body>${body}</body></html>`;
}
