import { compileSnippet, partialNames, TemplateCompileError } from "@necodoc/shared";
import { inArray, or } from "drizzle-orm";
import { LiquidError } from "liquidjs";
import { z } from "zod";
import { db } from "../db";
import { snippet } from "../db/schema";
import { liquid } from "./liquid";

// ADR 0015: `{% render 'name' %}` reads snippets from Postgres (docs/features/snippet-library.md).
// They're loaded up front, every included snippet transitively, so the render itself reads from
// memory and a publish can store exactly what it rendered with.

/** A snippet that's missing, doesn't compile, or includes itself. */
export class PartialError extends Error {}

/** A snippet being saved: its new content stands in for the stored one. */
export type PendingSnippet = { id?: string; key: string; html: string };

type Loaded = { id: string; key: string; html: string };

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
  const byName = new Map<string, Loaded>();
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

  for (const loaded of new Set(byName.values())) parseOrThrow(loaded);
  throwOnCycle(byName);
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

function snippetHtml(key: string, content: Parameters<typeof compileSnippet>[0]) {
  try {
    return compileSnippet(content);
  } catch (error) {
    if (error instanceof TemplateCompileError) {
      throw new PartialError(`Snippet "${key}": ${error.message}`);
    }
    throw error;
  }
}

function parseOrThrow({ key, html }: Loaded) {
  try {
    liquid.parse(html);
  } catch (error) {
    if (error instanceof LiquidError) throw new PartialError(`Snippet "${key}": ${error.message}`);
    throw error;
  }
}

/** Depth-first over snippet → included snippets; any back edge is a cycle. */
function throwOnCycle(byName: ReadonlyMap<string, Loaded>) {
  const done = new Set<Loaded>();
  const visit = (node: Loaded, path: Loaded[]) => {
    if (done.has(node)) return;
    const at = path.indexOf(node);
    if (at !== -1) {
      const cycle = [...path.slice(at), node].map((s) => s.key).join(" → ");
      throw new PartialError(`Snippets include each other in a loop: ${cycle}`);
    }
    for (const name of partialNames(node.html)) {
      const next = byName.get(name);
      if (next) visit(next, [...path, node]);
    }
    done.add(node);
  };
  for (const node of new Set(byName.values())) visit(node, []);
}
