import { z } from "zod";
import type { Field, FieldSection } from "./fields";
import type { DesignedContent } from "./template";

// Spec: docs/features/document-localization.md. ADR 0040: one document language (`output.lang`)
// and translation tables keyed by the template's own source text.

/** A BCP 47 language tag such as `en` or `fr-CA`. */
export const languageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Use a language tag such as en or fr-CA");

/** Source text to its translation, for one language. */
export type Strings = Readonly<Record<string, string>>;

/** `{ "<lang>": { "<source text>": "<translation>" } }`. An empty translation means none yet. */
export const translationsSchema = z
  .record(languageTagSchema, z.record(z.string().min(1).max(5000), z.string().max(20_000)))
  .meta({
    id: "Translations",
    description:
      'Per language, source text to its translation: `{ "fr": { "Invoice": "Facture" } }`.',
  });
export type Translations = z.infer<typeof translationsSchema>;

/**
 * The strings for `lang`: its language's table (`fr`) with the exact tag's (`fr-CA`) over it.
 * Tags match case-insensitively; empty translations are left out, so they fall back.
 */
export function stringsFor(translations: Translations | undefined, lang: string): Strings {
  if (!translations) return {};
  const tables = new Map(Object.entries(translations).map(([tag, t]) => [tag.toLowerCase(), t]));
  const exact = lang.toLowerCase();
  const language = exact.split("-")[0] ?? exact;
  const merged = { ...(language !== exact ? tables.get(language) : {}), ...tables.get(exact) };
  return Object.fromEntries(Object.entries(merged).filter(([, text]) => text !== ""));
}

/** The translation, or the source text when there's none. */
export const translate = (strings: Strings, text: string) =>
  Object.hasOwn(strings, text) ? (strings[text] ?? text) : text;

const RTL_LANGUAGES = new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "he",
  "iw",
  "ks",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);
const RTL_SCRIPTS = new Set(["arab", "hebr", "syrc", "thaa", "nkoo", "adlm", "rohg"]);

/** Text direction for a language tag; a script subtag (`az-Arab`, `pa-Latn`) decides first. */
export function textDirection(lang: string): "ltr" | "rtl" {
  const [language = "", ...rest] = lang.toLowerCase().split("-");
  const script = rest.find((part) => part.length === 4 && /^[a-z]+$/.test(part));
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

/** Fields and sections with their labels, help and choice labels translated (the guided form). */
export function translateSections(
  sections: readonly FieldSection[],
  strings: Strings,
): FieldSection[] {
  if (!Object.keys(strings).length) return [...sections];
  const t = (text: string) => translate(strings, text);
  const field = <F extends Field>(f: F): F => {
    const out = { ...f, label: t(f.label), ...(f.help ? { help: t(f.help) } : {}) };
    if (out.type === "choice") {
      return { ...out, options: out.options.map((o) => ({ ...o, label: t(o.label) })) };
    }
    if (out.type === "group") return { ...out, fields: out.fields.map(field) };
    return out;
  };
  return sections.map((s) => ({
    ...s,
    title: t(s.title),
    ...(s.description ? { description: t(s.description) } : {}),
    fields: s.fields.map(field),
  }));
}

/** `"..." | t` and `'...' | t` in Liquid source (code mode, overlay boxes). */
const T_LITERAL = /"([^"]*)"\s*\|\s*t(?![\w-])|'([^']*)'\s*\|\s*t(?![\w-])/g;

export const liquidTranslatables = (source: string) =>
  [...source.matchAll(T_LITERAL)].map((m) => m[1] ?? m[2] ?? "");

/** Every text run in TipTap JSON, trimmed: what the visual compile looks up (compile.ts). */
export function docTexts(node: unknown): string[] {
  if (typeof node !== "object" || node === null) return [];
  const texts: string[] = [];
  if ("type" in node && node.type === "text" && "text" in node && typeof node.text === "string") {
    texts.push(node.text.trim());
  }
  if ("content" in node && Array.isArray(node.content)) {
    for (const child of node.content) texts.push(...docTexts(child));
  }
  return texts;
}

/** The labels, help and section text of a template's fields. */
function fieldTexts(sections: readonly FieldSection[]) {
  const field = (f: Field): string[] => [
    f.label,
    f.help ?? "",
    ...(f.type === "choice" ? f.options.map((o) => o.label) : []),
    ...(f.type === "group" ? f.fields.flatMap(field) : []),
  ];
  return sections.flatMap((s) => [s.title, s.description ?? "", ...s.fields.flatMap(field)]);
}

/**
 * What a template can translate, in order without repeats: fields first, then content text
 * (`texts`: visual text runs, or `| t` literals in code and overlay boxes).
 */
export function translatableStrings(sections: readonly FieldSection[], texts: readonly string[]) {
  return [...new Set([...fieldTexts(sections), ...texts].filter((text) => text !== ""))];
}

/** Content as stored, or as the editor holds it (visual docs as loose TipTap JSON). */
export type TranslatableContent =
  | { boxes: readonly { value: string }[] }
  | Pick<Extract<DesignedContent, { mode: "code" }>, "mode" | "body" | "header" | "footer">
  | {
      mode: "visual";
      body: unknown;
      header: { doc: unknown; firstPage?: unknown } | null;
      footer: { doc: unknown; firstPage?: unknown } | null;
    };

/** The content's translatable text: visual text runs, or `| t` literals in code and boxes. */
export function contentTexts(content: TranslatableContent): string[] {
  if ("boxes" in content) return content.boxes.flatMap((box) => liquidTranslatables(box.value));
  if (content.mode === "code") {
    const bands = [content.header, content.footer].flatMap((band) =>
      band ? [band.html, band.firstPageHtml ?? ""] : [],
    );
    return [content.body, ...bands].flatMap(liquidTranslatables);
  }
  const bands = [content.header, content.footer].flatMap((band) =>
    band ? [band.doc, band.firstPage] : [],
  );
  return [content.body, ...bands].flatMap(docTexts);
}
