import type { ThemeSettings } from "@necodoc/shared";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { theme } from "./db/schema";

// Starters from docs/features/document-themes.md. Fixed ids so seeding is idempotent and
// edits here reach the database on the next boot.

const plain: ThemeSettings = {
  font: "noto-sans",
  fontSize: 11,
  lineHeight: 1.45,
  textColor: "#1f2328",
  accentColor: "#d0d7de",
  linkColor: "#0b5cad",
  headingFont: "noto-sans",
  headingColor: "#1f2328",
  h1Size: 22,
  h2Size: 16,
  h3Size: 13,
  tableBorderColor: "#d0d7de",
  tableHeaderBackground: "#f3f4f6",
  tableCellPadding: 1.5,
};

const builtinThemes = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Plain", settings: plain, css: "" },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Formal serif",
    settings: {
      ...plain,
      font: "noto-serif",
      headingFont: "noto-serif",
      fontSize: 11.5,
      lineHeight: 1.5,
      textColor: "#111111",
      headingColor: "#111111",
      accentColor: "#8a7a5c",
      tableBorderColor: "#8a7a5c",
      tableHeaderBackground: "#f4f0e8",
    },
    css: "h1, h2 { font-weight: 400; letter-spacing: 0.02em; } p { text-align: justify; }",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Modern sans",
    settings: {
      ...plain,
      font: "inter",
      headingFont: "inter",
      fontSize: 10.5,
      lineHeight: 1.5,
      textColor: "#27272a",
      headingColor: "#4338ca",
      accentColor: "#4338ca",
      linkColor: "#4338ca",
      tableBorderColor: "#e4e4e7",
      tableHeaderBackground: "#eef2ff",
      tableCellPadding: 2,
    },
    css: "th, td { border-width: 0 0 1px; }",
  },
] satisfies { id: string; name: string; settings: ThemeSettings; css: string }[];

export async function seedBuiltinThemes() {
  await db
    .insert(theme)
    .values(builtinThemes.map((t) => ({ ...t, builtIn: true })))
    .onConflictDoUpdate({
      target: theme.id,
      set: {
        name: sql`excluded.name`,
        settings: sql`excluded.settings`,
        css: sql`excluded.css`,
        builtIn: true,
      },
    });
}
