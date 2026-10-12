import type {
  BlockNode,
  Condition,
  Doc,
  InlineNode,
  Mark,
  MergeFilter,
  SigningKind,
  TableRowNode,
} from "@necodoc/shared";

// TipTap JSON builders for the demo's designed templates (docs/features/demo-data-and-screenshots.md),
// in the shapes template-doc.ts accepts. Strings are text runs.

type Inline = InlineNode | string;
type Align = "left" | "center" | "right" | "justify";

const inline = (parts: Inline[]): InlineNode[] =>
  parts.map((part) => (typeof part === "string" ? { type: "text", text: part } : part));

export const doc = (...content: BlockNode[]): Doc => ({ type: "doc", content });

export const text = (value: string, ...marks: Mark[]): InlineNode => ({
  type: "text",
  text: value,
  marks,
});
export const bold = (value: string) => text(value, { type: "bold" });
export const br: InlineNode = { type: "hardBreak" };

/** A merge field: `key`, or `group.key` inside a repeat. */
export const field = (path: string, filter?: MergeFilter): InlineNode => ({
  type: "mergeField",
  attrs: { field: path, filter: filter ?? null },
});
export const date = (path: string, format = "MMMM D, YYYY") =>
  field(path, { name: "date", format });
export const money = (path: string, currency = "CAD") =>
  field(path, { name: "currency", currency });
export const lines = (path: string) => field(path, { name: "lines" });

export const signBox = (
  signerId: string,
  kind: SigningKind,
  width = 60,
  height = 12,
): InlineNode => ({
  type: "signBox",
  attrs: { signerId, kind, width, height, required: true },
});

export const p = (...parts: Inline[]): BlockNode => ({ type: "paragraph", content: inline(parts) });
export const pa = (textAlign: Align, ...parts: Inline[]): BlockNode => ({
  type: "paragraph",
  attrs: { textAlign },
  content: inline(parts),
});
export const h = (level: 1 | 2 | 3, value: string, textAlign: Align = "left"): BlockNode => ({
  type: "heading",
  attrs: { level, textAlign },
  content: inline([value]),
});
export const ul = (...items: Inline[][]): BlockNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(...item)] })),
});
export const hr: BlockNode = { type: "horizontalRule" };
export const pageBreak: BlockNode = { type: "pageBreak" };

const cell = (type: "tableCell" | "tableHeader", parts: Inline[]) => ({
  type,
  content: [p(...parts)],
});
export const th = (...parts: Inline[]) => cell("tableHeader", parts);
export const td = (...parts: Inline[]) => cell("tableCell", parts);
export const tr = (cells: ReturnType<typeof cell>[], repeat?: string): TableRowNode => ({
  type: "tableRow",
  attrs: { repeat: repeat ?? null },
  content: cells,
});
export const table = (...rows: TableRowNode[]): BlockNode => ({ type: "table", content: rows });

export const when = (condition: Condition, ...content: BlockNode[]): BlockNode => ({
  type: "conditionalSection",
  attrs: { condition },
  content,
});
export const each = (group: string, ...content: BlockNode[]): BlockNode => ({
  type: "repeatingSection",
  attrs: { field: group },
  content,
});
export const image = (assetId: string, alt: string, width?: number): BlockNode => ({
  type: "image",
  attrs: { assetId, alt, width: width ?? null },
});
export const snippet = (snippetId: string): BlockNode => ({
  type: "snippet",
  attrs: { snippetId },
});
