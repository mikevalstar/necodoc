// Cobalt tokens (apps/web/src/styles/global.css, ADR 0042) and the self-hosted fonts.

import fragment from "@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2";
import bricolage from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2";
import figtree from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2";
import { loadFont } from "@remotion/fonts";

export const color = {
  paper: "#ffffff",
  canvas: "#f5f6fb",
  tint: "#eceefb",
  ink: "#0c1233",
  ink2: "#3f4668",
  ink3: "#5b6285",
  hair: "#e3e5f2",
  brand: "#2f6bff",
  brandInk: "#1f50e0",
  brandWash: "#e7eeff",
  night: "#0b1238",
  nightDeep: "#070c2a",
  nightFg: "#eef0ff",
  nightFg2: "#aeb7e6",
  nightHair: "rgba(255, 255, 255, 0.1)",
  sun: "#ffc53d",
  sunInk: "#3a2900",
  ok: "#0b7a52",
  okWash: "#dcf5e9",
} as const;

export const font = {
  display: "Bricolage Grotesque",
  sans: "Figtree",
  mono: "Fragment Mono",
} as const;

export const shadow = "0 2px 4px rgba(12, 18, 51, 0.06), 0 40px 80px -30px rgba(12, 18, 51, 0.4)";

loadFont({ family: font.display, url: bricolage, weight: "200 800" });
loadFont({ family: font.sans, url: figtree, weight: "300 900" });
loadFont({ family: font.mono, url: fragment, weight: "400" });
