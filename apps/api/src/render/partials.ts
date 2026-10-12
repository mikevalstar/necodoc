import { compileSnippet, partialNames, TemplateCompileError } from "@necodoc/shared";
import { LiquidError } from "liquidjs";
import { liquid } from "./liquid";

// ADR 0015: the checks on snippets loaded for `{% render 'name' %}` (docs/features/snippet-library.md).
// Loading them from Postgres is src/snippets.ts; this stays DB-free.

/** A snippet that's missing, doesn't compile, or includes itself. */
export class PartialError extends Error {}

export type LoadedSnippet = { id: string; key: string; html: string };

/** A stored snippet's HTML, or PartialError naming the snippet when it doesn't compile. */
export function snippetHtml(key: string, content: Parameters<typeof compileSnippet>[0]) {
  try {
    return compileSnippet(content);
  } catch (error) {
    if (error instanceof TemplateCompileError) {
      throw new PartialError(`Snippet "${key}": ${error.message}`);
    }
    throw error;
  }
}

/**
 * Throws PartialError for a loaded snippet whose Liquid doesn't parse, or for snippets that
 * include each other, with the cycle spelled out. `byName` maps every included name to its snippet.
 */
export function checkPartials(byName: ReadonlyMap<string, LoadedSnippet>) {
  for (const loaded of new Set(byName.values())) parseOrThrow(loaded);
  throwOnCycle(byName);
}

function parseOrThrow({ key, html }: LoadedSnippet) {
  try {
    liquid.parse(html);
  } catch (error) {
    if (error instanceof LiquidError) throw new PartialError(`Snippet "${key}": ${error.message}`);
    throw error;
  }
}

/** Depth-first over snippet → included snippets; any back edge is a cycle. */
function throwOnCycle(byName: ReadonlyMap<string, LoadedSnippet>) {
  const done = new Set<LoadedSnippet>();
  const visit = (node: LoadedSnippet, path: LoadedSnippet[]) => {
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
