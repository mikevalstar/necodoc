import { z } from "zod";

// Spec: docs/features/command-palette.md. The palette's pure parts: matching and the recent list
// (stored per browser). Tested in command-palette.test.ts.

/** Every word of the query appears in the text, case-insensitive, any order. */
export function matches(text: string, query: string) {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export const recentKinds = [
  "Pages",
  "Templates",
  "Documents",
  "Generations",
  "Snippets",
  "Themes",
  "Users",
] as const;

/** A page or record opened from the palette; an href so it survives a reload. */
const recentSchema = z.object({
  /** Same-origin paths only: never "//host". */
  href: z.string().regex(/^\/(?!\/)/),
  label: z.string(),
  kind: z.enum(recentKinds),
});
export type Recent = z.infer<typeof recentSchema>;

export const RECENT_MAX = 6;

/** Most recent first, one entry per href. */
export const pushRecent = (list: readonly Recent[], item: Recent): Recent[] =>
  [item, ...list.filter((entry) => entry.href !== item.href)].slice(0, RECENT_MAX);

/** Whatever is stored, as a valid list: bad JSON or old shapes read as empty. */
export function parseRecent(stored: string | null): Recent[] {
  try {
    return z
      .array(recentSchema)
      .catch([])
      .parse(JSON.parse(stored ?? "[]"))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
