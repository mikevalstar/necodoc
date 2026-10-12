import { z } from "zod";

// Spec: docs/features/document-themes.md

/** Open-licence fonts bundled with the API, keyed by id. */
export const bundledFonts = {
  "noto-sans": { family: "Noto Sans", generic: "sans-serif" },
  inter: { family: "Inter", generic: "sans-serif" },
  "noto-serif": { family: "Noto Serif", generic: "serif" },
  "jetbrains-mono": { family: "JetBrains Mono", generic: "monospace" },
} as const;
export type BundledFont = keyof typeof bundledFonts;

const bundledFontIds = Object.keys(bundledFonts) as [BundledFont, ...BundledFont[]];

/** A bundled font id, or an uploaded font asset. */
export const themeFontSchema = z.union([z.enum(bundledFontIds), z.object({ assetId: z.uuid() })]);
export type ThemeFont = z.infer<typeof themeFontSchema>;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");
/** Points. */
const fontSize = z.number().min(4).max(96);

export const themeSettingsSchema = z.object({
  font: themeFontSchema,
  fontSize,
  lineHeight: z.number().min(0.8).max(3),
  textColor: color,
  accentColor: color,
  linkColor: color,
  headingFont: themeFontSchema,
  headingColor: color,
  h1Size: fontSize,
  h2Size: fontSize,
  h3Size: fontSize,
  tableBorderColor: color,
  tableHeaderBackground: color,
  /** Millimetres. */
  tableCellPadding: z.number().min(0).max(20),
});
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

const themeName = z.string().trim().min(1, "Enter a name").max(100);
/** Free CSS appended after the settings. */
const themeCss = z.string().max(200_000);

export const themeInputSchema = z.object({
  settings: themeSettingsSchema,
  css: themeCss.default(""),
});
export type ThemeInput = z.infer<typeof themeInputSchema>;
export const createThemeSchema = themeInputSchema.extend({ name: themeName });
export const updateThemeSchema = z
  .object({ name: themeName, settings: themeSettingsSchema, css: themeCss })
  .partial();

export const themeSchema = createThemeSchema.extend({
  id: z.uuid(),
  builtIn: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Theme = z.infer<typeof themeSchema>;
export const themeListItemSchema = themeSchema.extend({
  /** Templates whose draft or published versions use it. */
  templateCount: z.number().int(),
});
export type ThemeListItem = z.infer<typeof themeListItemSchema>;

/** Asset ids of the uploaded fonts a theme uses. */
export function themeFontAssetIds(settings: ThemeSettings): string[] {
  return [settings.font, settings.headingFont].flatMap((font) =>
    typeof font === "string" ? [] : [font.assetId],
  );
}

/**
 * The templates using a theme (docs/features/document-themes.md): through the draft, or through
 * published versions that froze a copy of it. `current` is false for a copy older than the
 * theme's settings and CSS now.
 */
export const themeUsageSchema = z.object({
  templates: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      archived: z.boolean(),
      draft: z.boolean(),
      /** Newest first. */
      versions: z.array(z.object({ version: z.number().int(), current: z.boolean() })),
    }),
  ),
});
export type ThemeUsage = z.infer<typeof themeUsageSchema>;
