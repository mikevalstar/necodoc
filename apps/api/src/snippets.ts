import { partialNames } from "@necodoc/shared";
import { inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { snippet } from "./db/schema";
import { checkPartials, type LoadedSnippet, PartialError, snippetHtml } from "./render/partials";

// ADR 0015: `{% render 'name' %}` reads snippets from Postgres (docs/features/snippet-library.md).
// They're loaded up front, every included snippet transitively, so the render itself reads from
// memory and a publish can store exactly what it rendered with.

/** A snippet being saved: its new content stands in for the stored one. */
type PendingSnippet = { id?: string; key: string; html: string };

const isId = (name: string) => z.uuid().safeParse(name).success;

/**
 * HTML by name for every partial the sources include, directly or through other snippets. Names
 * are snippet keys or ids (visual snippet blocks). Throws PartialError for a missing snippet, a
 * snippet whose Liquid doesn't parse, or a cycle, with the cycle spelled out.
 */
export async function loadPartials(
  sources: readonly string[],
  pending?: PendingSnippet,
): Promise<Record<string, string>> {
  const byName = new Map<string, LoadedSnippet>();
  const ownSnippet = pending ? { ...pending, id: pending.id ?? "" } : null;
  const own = (name: string) =>
    ownSnippet && (name === ownSnippet.key || name === ownSnippet.id) ? ownSnippet : null;
  let wanted = [...new Set(sources.flatMap(partialNames))];
  while (wanted.length) {
    const rows = await findSnippets(wanted.filter((name) => !own(name)));
    const added = wanted.map((name) => {
      const row = rows.find((r) => r.id === name || r.key === name);
      const loaded =
        own(name) ?? (row && { id: row.id, key: row.key, html: snippetHtml(row.key, row.content) });
      if (!loaded) throw new PartialError(`Snippet "${name}" doesn't exist`);
      byName.set(name, loaded);
      return loaded;
    });
    wanted = [...new Set(added.flatMap((s) => partialNames(s.html)))].filter(
      (name) => !byName.has(name),
    );
  }

  checkPartials(byName);
  return Object.fromEntries([...byName].map(([name, loaded]) => [name, loaded.html]));
}

async function findSnippets(names: readonly string[]) {
  if (!names.length) return [];
  const ids = names.filter(isId);
  const keys = names.filter((name) => !isId(name));
  return db
    .select({ id: snippet.id, key: snippet.key, content: snippet.content })
    .from(snippet)
    .where(
      or(
        ids.length ? inArray(snippet.id, ids) : undefined,
        keys.length ? inArray(snippet.key, keys) : undefined,
      ),
    );
}
