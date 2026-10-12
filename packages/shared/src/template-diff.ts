import { z } from "zod";
import type { Field, FieldSection } from "./fields";
import type { OverlayBox, OverlayContent } from "./overlay";
import type { PageOptions } from "./render";
import type { DesignedContent, TemplateKind } from "./template";
import type { ThemeInput } from "./theme";

// Specs: docs/features/publishing-and-versions.md (diff), docs/features/review-and-approval.md,
// docs/features/ai-template-assistant.md (version summaries). What changed between a published
// version and the draft, structurally. Browser-safe: the API computes it for reviews and AI, the
// app renders it.

/** Either side of a diff: a published version, or the draft with its current theme. */
export type DiffableTemplate = {
  kind: TemplateKind;
  name: string;
  description: string;
  sections: FieldSection[];
  sampleData: Record<string, unknown>;
  content: DesignedContent | OverlayContent;
  /** Designed only. */
  page?: PageOptions;
  themeId?: string | null;
  /** The theme's settings and CSS: frozen on a version, current on the draft. */
  theme?: ThemeInput | null;
  /** Snippet HTML by render name: frozen on a version, current on the draft. */
  partials?: Record<string, string>;
};

const ref = z.object({ key: z.string(), label: z.string() });
const blockChange = z.object({
  op: z.enum(["added", "removed", "changed"]),
  /** Position in the draft's body (the version's, for removed blocks). 0-based. */
  index: z.number().int(),
  type: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
});
const boxRef = z.object({
  id: z.string(),
  page: z.number().int(),
  type: z.string(),
  label: z.string(),
});

export const templateDiffSchema = z.object({
  name: z.object({ before: z.string(), after: z.string() }).nullable(),
  description: z.boolean(),
  sections: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(z.string()),
  }),
  fields: z.object({
    added: z.array(ref),
    removed: z.array(ref),
    changed: z.array(ref.extend({ changes: z.array(z.string()) })),
  }),
  content: z.object({
    /** "visual → code", when the mode changed. */
    mode: z.string().nullable(),
    blocks: z.array(blockChange),
    /** Code mode (or a mode change): body lines added and removed. */
    lines: z.object({ added: z.number().int(), removed: z.number().int() }).nullable(),
  }),
  header: z.boolean(),
  footer: z.boolean(),
  css: z.boolean(),
  page: z.array(z.string()),
  theme: z.array(z.string()),
  boxes: z.object({
    added: z.array(boxRef),
    removed: z.array(boxRef),
    changed: z.array(boxRef.extend({ changes: z.array(z.string()) })),
  }),
  /** Snippets (by render name) whose content differs, or that were added or dropped. */
  snippets: z.array(z.string()),
  /** The overlay's PDF was replaced. */
  source: z.boolean(),
  /** Languages whose translations were added, removed or changed (ADR 0040). */
  translations: z.array(z.string()).default([]),
  sampleData: z.boolean(),
});
export type TemplateDiff = z.infer<typeof templateDiffSchema>;
export type BlockChange = z.infer<typeof blockChange>;

/** JSON with object keys sorted, so equal values compare equal however they were stored. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

export type SequenceOp<T> = { op: "equal" | "added" | "removed"; item: T };

/**
 * Longest-common-subsequence diff of two lists. Common ends are trimmed first; past ~4M cells the
 * middle is reported as removed-then-added rather than spending the memory.
 */
export function diffSequence<T>(
  a: readonly T[],
  b: readonly T[],
  key: (item: T) => string = (item) => stableStringify(item),
): SequenceOp<T>[] {
  const ka = a.map(key);
  const kb = b.map(key);
  let start = 0;
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((item) => ({ op: "equal" as const, item }));
  const tail = a.slice(endA).map((item) => ({ op: "equal" as const, item }));
  const n = endA - start;
  const m = endB - start;
  const middle: SequenceOp<T>[] = [];
  if (n * m > 4_000_000) {
    for (const item of a.slice(start, endA)) middle.push({ op: "removed", item });
    for (const item of b.slice(start, endB)) middle.push({ op: "added", item });
    return [...head, ...middle, ...tail];
  }
  // cell(i, j): LCS length of a[start+i..endA) and b[start+j..endB), row-major.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  const cell = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        ka[start + i] === kb[start + j]
          ? cell(i + 1, j + 1) + 1
          : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const restA = a.slice(start, endA);
  const restB = b.slice(start, endB);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const itemA = restA[i];
    const itemB = restB[j];
    if (i < n && j < m && ka[start + i] === kb[start + j] && itemA !== undefined) {
      middle.push({ op: "equal", item: itemA });
      i++;
      j++;
    } else if (itemB !== undefined && (i === n || cell(i, j + 1) >= cell(i + 1, j))) {
      middle.push({ op: "added", item: itemB });
      j++;
    } else if (itemA !== undefined) {
      middle.push({ op: "removed", item: itemA });
      i++;
    } else {
      break;
    }
  }
  return [...head, ...middle, ...tail];
}

/** Line diff, for page text and code-mode bodies. */
export const diffLines = (before: string, after: string) =>
  diffSequence(before.split("\n"), after.split("\n"), (line) => line);

// ---------------------------------------------------------------------------------------------
// Fields and sections

type FlatField = { key: string; label: string; section: string; field: Field };

function flatFields(sections: readonly FieldSection[]): Map<string, FlatField> {
  const out = new Map<string, FlatField>();
  for (const section of sections) {
    for (const field of section.fields) {
      out.set(field.key, { key: field.key, label: field.label, section: section.title, field });
      if (field.type !== "group") continue;
      for (const child of field.fields) {
        const key = `${field.key}.${child.key}`;
        out.set(key, {
          key,
          label: `${field.label} › ${child.label}`,
          section: section.title,
          field: child,
        });
      }
    }
  }
  return out;
}

/** Which properties differ; a group's children are diffed as fields of their own. */
function fieldChanges(before: FlatField, after: FlatField): string[] {
  const changes: string[] = [];
  if (before.section !== after.section) changes.push(`moved to "${after.section}"`);
  const a: Record<string, unknown> = { ...before.field, fields: undefined };
  const b: Record<string, unknown> = { ...after.field, fields: undefined };
  for (const prop of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (prop === "key" || prop === "fields") continue;
    if (!same(a[prop], b[prop])) changes.push(prop === "showIf" ? "show-if" : prop);
  }
  return changes;
}

function diffFields(before: readonly FieldSection[], after: readonly FieldSection[]) {
  const a = flatFields(before);
  const b = flatFields(after);
  const pick = ({ key, label }: FlatField) => ({ key, label });
  return {
    added: [...b.values()].filter((f) => !a.has(f.key)).map(pick),
    removed: [...a.values()].filter((f) => !b.has(f.key)).map(pick),
    changed: [...b.values()].flatMap((f) => {
      const old = a.get(f.key);
      const changes = old ? fieldChanges(old, f) : [];
      return changes.length ? [{ ...pick(f), changes }] : [];
    }),
  };
}

function diffSections(before: readonly FieldSection[], after: readonly FieldSection[]) {
  const a = new Map(before.map((s, i) => [s.title, { s, i }]));
  const b = new Map(after.map((s, i) => [s.title, { s, i }]));
  const meta = ({ s }: { s: FieldSection }) => [s.description ?? "", s.showIf ?? null];
  return {
    added: after.filter((s) => !a.has(s.title)).map((s) => s.title),
    removed: before.filter((s) => !b.has(s.title)).map((s) => s.title),
    changed: after.flatMap((s, i) => {
      const old = a.get(s.title);
      return old && (old.i !== i || !same(meta(old), meta({ s }))) ? [s.title] : [];
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Content

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

/** A block's text with merge fields as {{ key }}, for a one-line preview. */
function nodeText(node: JsonNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mergeField") return `{{ ${String(node.attrs?.field ?? "")} }}`;
  if (node.type === "hardBreak") return " ";
  const inner = (node.content ?? []).map(nodeText);
  return node.type === "paragraph" || node.type === "heading" ? inner.join("") : inner.join(" ");
}

const preview = (node: JsonNode) => {
  const text = nodeText(node).replace(/\s+/g, " ").trim();
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
};

/** Top-level body blocks added, removed or changed; a removal followed by an addition is a change. */
function diffBlocks(before: readonly JsonNode[], after: readonly JsonNode[]): BlockChange[] {
  const out: BlockChange[] = [];
  let ia = 0;
  let ib = 0;
  let removed: JsonNode[] = [];
  let added: JsonNode[] = [];
  // Pairs a run of removals with the run of additions next to it.
  const flush = () => {
    for (let p = 0; p < Math.max(removed.length, added.length); p++) {
      const a = removed[p];
      const b = added[p];
      if (a && b) {
        out.push({
          op: "changed",
          index: ib++,
          type: b.type ?? "block",
          before: preview(a),
          after: preview(b),
        });
        ia++;
      } else if (a) {
        out.push({ op: "removed", index: ia++, type: a.type ?? "block", before: preview(a) });
      } else if (b) {
        out.push({ op: "added", index: ib++, type: b.type ?? "block", after: preview(b) });
      }
    }
    removed = [];
    added = [];
  };
  for (const { op, item } of diffSequence(before, after)) {
    if (op === "removed") removed.push(item);
    else if (op === "added") added.push(item);
    else {
      flush();
      ia++;
      ib++;
    }
  }
  flush();
  return out;
}

const bodyText = (content: DesignedContent) =>
  content.mode === "code"
    ? content.body
    : (content.body.content as JsonNode[]).map(nodeText).join("\n");

function diffContent(before: DesignedContent, after: DesignedContent): TemplateDiff["content"] {
  if (before.mode === "visual" && after.mode === "visual") {
    return {
      mode: null,
      blocks: diffBlocks(before.body.content as JsonNode[], after.body.content as JsonNode[]),
      lines: null,
    };
  }
  const ops = diffLines(bodyText(before), bodyText(after));
  return {
    mode: before.mode === after.mode ? null : `${before.mode} → ${after.mode}`,
    blocks: [],
    lines: {
      added: ops.filter((o) => o.op === "added").length,
      removed: ops.filter((o) => o.op === "removed").length,
    },
  };
}

function diffPage(before: PageOptions | undefined, after: PageOptions | undefined) {
  if (!before || !after) return [];
  const changes: string[] = [];
  if (before.size !== after.size) changes.push(`Page size ${before.size} → ${after.size}`);
  if (before.orientation !== after.orientation) {
    changes.push(`Orientation ${before.orientation} → ${after.orientation}`);
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    if (before.margins[side] !== after.margins[side]) {
      changes.push(
        `${side[0]?.toUpperCase()}${side.slice(1)} margin ${before.margins[side]} → ${after.margins[side]} mm`,
      );
    }
  }
  return changes;
}

function diffTheme(before: DiffableTemplate, after: DiffableTemplate) {
  if ((before.themeId ?? null) !== (after.themeId ?? null)) {
    return [after.themeId ? (before.themeId ? "Theme changed" : "Theme added") : "Theme removed"];
  }
  const changes: string[] = [];
  if (!same(before.theme?.settings ?? null, after.theme?.settings ?? null)) {
    changes.push("Theme settings changed");
  }
  if ((before.theme?.css ?? "") !== (after.theme?.css ?? "")) changes.push("Theme CSS changed");
  return changes;
}

function diffPartials(before?: Record<string, string>, after?: Record<string, string>) {
  if (!before || !after) return [];
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

// ---------------------------------------------------------------------------------------------
// Overlay boxes

const boxLabel = (box: OverlayBox) => {
  const value = box.value.replace(/\s+/g, " ").trim();
  return value.length > 60 ? `${value.slice(0, 59)}…` : value || box.acroField || "(empty)";
};
const pickBox = (box: OverlayBox) => ({
  id: box.id,
  page: box.page,
  type: box.type,
  label: boxLabel(box),
});

function boxChanges(a: OverlayBox, b: OverlayBox): string[] {
  const changes: string[] = [];
  if (a.page !== b.page) changes.push(`page ${a.page} → ${b.page}`);
  if (a.rect.x !== b.rect.x || a.rect.y !== b.rect.y) changes.push("moved");
  if (a.rect.width !== b.rect.width || a.rect.height !== b.rect.height) changes.push("resized");
  if (a.type !== b.type) changes.push(`type ${a.type} → ${b.type}`);
  if (a.value !== b.value) changes.push("value");
  const rest = (box: OverlayBox) => ({ ...box, id: 0, page: 0, rect: 0, type: 0, value: 0 });
  if (!same(rest(a), rest(b))) changes.push("style or options");
  return changes;
}

function diffBoxes(before: readonly OverlayBox[], after: readonly OverlayBox[]) {
  const a = new Map(before.map((box) => [box.id, box]));
  const b = new Map(after.map((box) => [box.id, box]));
  return {
    added: after.filter((box) => !a.has(box.id)).map(pickBox),
    removed: before.filter((box) => !b.has(box.id)).map(pickBox),
    changed: after.flatMap((box) => {
      const old = a.get(box.id);
      const changes = old ? boxChanges(old, box) : [];
      return changes.length ? [{ ...pickBox(box), changes }] : [];
    }),
  };
}

// ---------------------------------------------------------------------------------------------

const isOverlay = (content: DesignedContent | OverlayContent): content is OverlayContent =>
  "sourceId" in content;

/** What changed from `before` (a published version) to `after` (the draft). */
export function templateDiff(before: DiffableTemplate, after: DiffableTemplate): TemplateDiff {
  const a = before.content;
  const b = after.content;
  const designed = !isOverlay(a) && !isOverlay(b) ? { a, b } : null;
  const overlay = isOverlay(a) && isOverlay(b) ? { a, b } : null;
  return {
    name: before.name === after.name ? null : { before: before.name, after: after.name },
    description: before.description !== after.description,
    sections: diffSections(before.sections, after.sections),
    fields: diffFields(before.sections, after.sections),
    content: designed
      ? diffContent(designed.a, designed.b)
      : { mode: null, blocks: [], lines: null },
    header: designed ? !same(designed.a.header, designed.b.header) : false,
    footer: designed ? !same(designed.a.footer, designed.b.footer) : false,
    css: designed ? designed.a.css !== designed.b.css : false,
    page: designed ? diffPage(before.page, after.page) : [],
    theme: designed ? diffTheme(before, after) : [],
    snippets: diffPartials(before.partials, after.partials),
    boxes: overlay
      ? diffBoxes(overlay.a.boxes, overlay.b.boxes)
      : { added: [], removed: [], changed: [] },
    source: overlay
      ? overlay.a.sourceId !== overlay.b.sourceId || overlay.a.flatten !== overlay.b.flatten
      : false,
    sampleData: !same(before.sampleData, after.sampleData),
    translations: [...new Set([...Object.keys(a.translations), ...Object.keys(b.translations)])]
      .filter((lang) => !same(a.translations[lang], b.translations[lang]))
      .sort(),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const keys = (refs: readonly { key: string }[]) => refs.map((r) => r.key).join(", ");

/**
 * The diff as short sentences, most important first: for the review page's summary, the publish
 * dialog, and as the AI version-summary prompt. Empty when nothing changed.
 */
export function summarizeTemplateDiff(diff: TemplateDiff): string[] {
  const lines: string[] = [];
  const { fields, sections, content, boxes } = diff;
  if (diff.name) lines.push(`Renamed "${diff.name.before}" → "${diff.name.after}"`);
  if (fields.added.length) lines.push(`Fields added: ${keys(fields.added)}`);
  if (fields.removed.length) lines.push(`Fields removed: ${keys(fields.removed)}`);
  for (const f of fields.changed) lines.push(`Field ${f.key} changed: ${f.changes.join(", ")}`);
  if (sections.added.length) lines.push(`Sections added: ${sections.added.join(", ")}`);
  if (sections.removed.length) lines.push(`Sections removed: ${sections.removed.join(", ")}`);
  if (sections.changed.length) lines.push(`Sections changed: ${sections.changed.join(", ")}`);
  if (content.mode) lines.push(`Content switched ${content.mode}`);
  if (content.blocks.length) {
    const count = (op: BlockChange["op"]) => content.blocks.filter((b) => b.op === op).length;
    const parts = [
      count("added") && `${count("added")} added`,
      count("changed") && `${count("changed")} changed`,
      count("removed") && `${count("removed")} removed`,
    ].filter(Boolean);
    lines.push(`Content blocks: ${parts.join(", ")}`);
  }
  if (content.lines && (content.lines.added || content.lines.removed)) {
    lines.push(
      `Content: ${plural(content.lines.added, "line")} added, ${content.lines.removed} removed`,
    );
  }
  if (diff.header) lines.push("Header changed");
  if (diff.footer) lines.push("Footer changed");
  if (diff.css) lines.push("Template CSS changed");
  lines.push(...diff.page, ...diff.theme);
  if (diff.snippets.length) lines.push(`${plural(diff.snippets.length, "snippet")} changed`);
  if (diff.source) lines.push("PDF replaced or flatten changed");
  if (boxes.added.length) lines.push(`${plural(boxes.added.length, "box", "boxes")} added`);
  if (boxes.removed.length) lines.push(`${plural(boxes.removed.length, "box", "boxes")} removed`);
  if (boxes.changed.length) lines.push(`${plural(boxes.changed.length, "box", "boxes")} changed`);
  if (diff.translations.length) lines.push(`Translations changed: ${diff.translations.join(", ")}`);
  if (diff.description) lines.push("Description changed");
  if (diff.sampleData) lines.push("Sample data changed");
  return lines;
}
