import type { Condition, Field, FieldSection } from "./fields";
import { type OutputOptions, outputEnabled } from "./output";
import type { Band } from "./render";
import type { Signer } from "./signing";
import type { DesignedContent } from "./template";
import type { BlockNode, Doc, InlineNode, Mark, MergeFilter, TableRowNode } from "./template-doc";

// ADR 0016: TipTap JSON to HTML + Liquid (ADR 0015). The contract between the editor and the
// renderer. Text is HTML-escaped and `{`/`}` become entities, so typed text never turns into
// Liquid; field paths are schema-checked identifiers and string values are escaped literals.

export class TemplateCompileError extends Error {}

/** The repeat item variable; `item` is a reserved field key, so it never shadows a field. */
const ITEM = "item";

type Scope = {
  /** Paths whose values are lists (multiple choice): equality means "includes". */
  lists: ReadonlySet<string>;
  /** The group the enclosing repeating section iterates, if any. */
  repeat: string | null;
};

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "{": "&#123;",
  "}": "&#125;",
};

/** Escapes text for HTML content and attributes, Liquid delimiters included. */
export const escapeHtml = (text: string) => text.replace(/[&<>"'{}]/g, (ch) => ENTITIES[ch] ?? ch);

/**
 * A Liquid string literal. Everything but plain characters becomes a `\uXXXX` escape: a raw `%}`
 * inside quotes would end the tag.
 */
export const liquidString = (value: string) =>
  `"${value.replace(/[^\w ,.:/-]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;

const liquidValue = (value: string | number | boolean) =>
  typeof value === "string" ? liquidString(value) : String(value);

/** A field path as a Liquid variable, resolving `group.key` to the repeat item. */
function variable(path: string, scope: Scope) {
  const [group, key] = path.split(".");
  if (key === undefined) return path;
  if (group !== scope.repeat) {
    throw new TemplateCompileError(
      `"${path}" can only be used inside a repeating section over "${group}"`,
    );
  }
  return `${ITEM}.${key}`;
}

function filterLiquid(filter: MergeFilter) {
  switch (filter.name) {
    case "date":
      return ` | date: ${liquidString(filter.format)}`;
    case "number":
      return ` | number: ${filter.decimals}`;
    case "currency":
      return ` | currency: ${liquidString(filter.currency)}`;
    case "lines":
      // Escape first, then add <br>s; `raw` stops Liquid escaping the <br>s again.
      return " | escape | newline_to_br | raw";
    case "upcase":
    case "downcase":
    case "capitalize":
      return ` | ${filter.name}`;
  }
}

/** Opening and closing tags for a show-if condition. */
function conditionTags(condition: Condition, scope: Scope): [string, string] {
  const v = variable(condition.field, scope);
  const list = scope.lists.has(condition.field);
  const eq = (value: string | number | boolean) =>
    list ? `${v} contains ${liquidValue(value)}` : `${v} == ${liquidValue(value)}`;
  const ifTags = (expression: string): [string, string] => [
    `{% if ${expression} %}`,
    "{% endif %}",
  ];
  switch (condition.op) {
    case "is_set":
      return ifTags(`${v} != blank`);
    case "equals":
      return ifTags(eq(condition.value));
    case "not_equals":
      return [`{% unless ${eq(condition.value)} %}`, "{% endunless %}"];
    case "one_of":
      return ifTags(condition.values.map(eq).join(" or "));
    case "gt":
      return ifTags(`${v} > ${liquidValue(condition.value)}`);
    case "lt":
      return ifTags(`${v} < ${liquidValue(condition.value)}`);
  }
}

function markTags(mark: Mark): [string, string] {
  switch (mark.type) {
    case "bold":
      return ["<strong>", "</strong>"];
    case "italic":
      return ["<em>", "</em>"];
    case "underline":
      return ["<u>", "</u>"];
    case "strike":
      return ["<s>", "</s>"];
    case "link":
      return [`<a href="${escapeHtml(mark.attrs.href)}">`, "</a>"];
    case "textStyle":
      return mark.attrs.color ? [`<span style="color:${mark.attrs.color}">`, "</span>"] : ["", ""];
  }
}

const withMarks = (html: string, marks: readonly Mark[] = []) =>
  marks.reduceRight((inner, mark) => {
    const [open, close] = markTags(mark);
    return open + inner + close;
  }, html);

/** HTML collapses runs of spaces; TipTap shows them, so keep all but the last as &nbsp;. */
const keepSpaces = (html: string) => html.replace(/ (?= )/g, "&nbsp;");

function inlineHtml(node: InlineNode, scope: Scope): string {
  switch (node.type) {
    case "text":
      return withMarks(keepSpaces(escapeHtml(node.text)), node.marks);
    case "hardBreak":
      return "<br>";
    case "signBox": {
      // Kind and signer are schema-checked identifiers; the renderer locates `data-sign` boxes.
      const { kind, signerId, width, height, required } = node.attrs;
      const optional = required ? "" : " data-sign-optional";
      return `<span data-sign="${kind}" data-signer="${signerId}"${optional} style="width:${width}mm;height:${height}mm;border-bottom:1px solid currentColor"></span>`;
    }
    case "mergeField": {
      const { field, filter } = node.attrs;
      return withMarks(
        `{{ ${variable(field, scope)}${filter ? filterLiquid(filter) : ""} }}`,
        node.marks,
      );
    }
  }
}

const inlines = (nodes: readonly InlineNode[] | undefined, scope: Scope) =>
  (nodes ?? []).map((n) => inlineHtml(n, scope)).join("");

const alignStyle = (align: string | null | undefined) =>
  align && align !== "left" ? ` style="text-align:${align}"` : "";

const blocks = (nodes: readonly BlockNode[], scope: Scope) =>
  nodes.map((n) => blockHtml(n, scope)).join("");

function repeatScope(group: string, scope: Scope): Scope {
  if (scope.repeat) {
    throw new TemplateCompileError(
      `Repeating sections can't nest ("${group}" inside "${scope.repeat}")`,
    );
  }
  return { ...scope, repeat: group };
}

function rowHtml(row: TableRowNode, scope: Scope) {
  const group = row.attrs?.repeat;
  const inner = group ? repeatScope(group, scope) : scope;
  const cells = row.content
    .map((cell) => {
      const tag = cell.type === "tableHeader" ? "th" : "td";
      const span = (name: string, n: number | null | undefined) =>
        n && n > 1 ? ` ${name}="${n}"` : "";
      const attrs = span("colspan", cell.attrs?.colspan) + span("rowspan", cell.attrs?.rowspan);
      return `<${tag}${attrs}>${blocks(cell.content, inner)}</${tag}>`;
    })
    .join("");
  const tr = `<tr>${cells}</tr>`;
  return group ? `{% for ${ITEM} in ${group} %}${tr}{% endfor %}` : tr;
}

function blockHtml(node: BlockNode, scope: Scope): string {
  switch (node.type) {
    case "paragraph":
      // An empty paragraph is a blank line in the editor; keep its height.
      return `<p${alignStyle(node.attrs?.textAlign)}>${inlines(node.content, scope) || "<br>"}</p>`;
    case "heading": {
      const { level, textAlign } = node.attrs;
      return `<h${level}${alignStyle(textAlign)}>${inlines(node.content, scope)}</h${level}>`;
    }
    case "bulletList":
    case "orderedList": {
      const items = node.content.map((li) => `<li>${blocks(li.content, scope)}</li>`).join("");
      if (node.type === "bulletList") return `<ul>${items}</ul>`;
      const start = node.attrs?.start;
      return `<ol${start !== undefined && start !== null && start !== 1 ? ` start="${start}"` : ""}>${items}</ol>`;
    }
    case "blockquote":
      return `<blockquote>${blocks(node.content, scope)}</blockquote>`;
    case "horizontalRule":
      return "<hr>";
    case "pageBreak":
      // break-before, not break-after: when the page above is exactly full, this empty div lands
      // on the next page, and a break after it would leave that page blank.
      return '<div style="break-before:page"></div>';
    case "image": {
      const { assetId, field, alt, width } = node.attrs;
      const attrs = `alt="${escapeHtml(alt ?? "")}"${width ? ` style="width:${width}%"` : ""}`;
      if (assetId) return `<img src="{{ ${liquidString(assetId)} | asset_url }}" ${attrs}>`;
      if (!field) return "";
      // An empty image field shows nothing rather than a broken image.
      const v = variable(field, scope);
      return `{% if ${v} != blank %}<img src="{{ ${v} }}" ${attrs}>{% endif %}`;
    }
    case "table": {
      const headerCount = node.content.findIndex(
        (row) => row.attrs?.repeat || row.content.some((cell) => cell.type !== "tableHeader"),
      );
      const split = headerCount === -1 ? node.content.length : headerCount;
      const head = node.content
        .slice(0, split)
        .map((r) => rowHtml(r, scope))
        .join("");
      const body = node.content
        .slice(split)
        .map((r) => rowHtml(r, scope))
        .join("");
      return `<table>${head ? `<thead>${head}</thead>` : ""}${body ? `<tbody>${body}</tbody>` : ""}</table>`;
    }
    case "conditionalSection": {
      const [open, close] = conditionTags(node.attrs.condition, scope);
      return open + blocks(node.content, scope) + close;
    }
    case "repeatingSection": {
      const { field } = node.attrs;
      return `{% for ${ITEM} in ${field} %}${blocks(node.content, repeatScope(field, scope))}{% endfor %}`;
    }
    case "rawHtml":
      // Verbatim by design: the author asked for markup, not text.
      return node.attrs.html;
    case "snippet":
      return `{% render ${liquidString(node.attrs.snippetId)} %}`;
  }
}

/** Paths of multiple choice fields, top-level and inside groups. */
function listPaths(sections: readonly FieldSection[]) {
  const paths = new Set<string>();
  const isList = (field: Field) => field.type === "choice" && field.multiple;
  for (const field of sections.flatMap((s) => s.fields)) {
    if (isList(field)) paths.add(field.key);
    if (field.type === "group") {
      for (const child of field.fields) if (isList(child)) paths.add(`${field.key}.${child.key}`);
    }
  }
  return paths;
}

/**
 * One TipTap doc to HTML + Liquid. Throws TemplateCompileError on misplaced group fields.
 * `separator` goes between top-level blocks: code mode uses a newline so the HTML is readable.
 */
export function compileDoc(doc: Doc, sections: readonly FieldSection[] = [], separator = "") {
  const scope = { lists: listPaths(sections), repeat: null };
  return doc.content.map((n) => blockHtml(n, scope)).join(separator);
}

/**
 * What the renderer needs from a designed template: body HTML, bands and template CSS. Published
 * versions add `partials`, the snippet HTML they were published with.
 */
export type CompiledTemplate = {
  html: string;
  header?: Band;
  footer?: Band;
  css?: string;
  partials?: Record<string, string>;
  signers?: Signer[];
  output?: OutputOptions;
};

/** Every HTML/Liquid source a compiled template renders: body, then each band's variants. */
export const compiledSources = ({
  html,
  header,
  footer,
}: {
  html: string;
  header?: Band | null;
  footer?: Band | null;
}) =>
  [html, header?.html, header?.firstPageHtml, footer?.html, footer?.firstPageHtml].filter(
    (part): part is string => part !== undefined,
  );

/** `{% render 'name' %}` and `{% include 'name' %}` with a literal name. */
const PARTIAL_TAG = /\{%-?\s*(?:render|include)\s+(?:'([^']*)'|"([^"]*)")/g;

/**
 * The partials (snippet keys or ids) a Liquid source names, in order, without repeats. Only
 * literal names: a partial named by a variable isn't found.
 */
export function partialNames(source: string): string[] {
  const names = [...source.matchAll(PARTIAL_TAG)].map((m) => m[1] ?? m[2] ?? "");
  return [...new Set(names.filter(Boolean))];
}

/** Compiles a designed template's body and bands. Code mode is already compiled. */
export function compileDesignedContent(
  content: DesignedContent,
  sections: readonly FieldSection[],
): CompiledTemplate {
  const css = content.css ? { css: content.css } : {};
  const signers = content.signers.length ? { signers: content.signers } : {};
  // Only when something is on, so templates that never set it keep their publish fingerprint.
  const output = outputEnabled(content.output) ? { output: content.output } : {};
  if (content.mode === "code") {
    return {
      html: content.body,
      ...(content.header ? { header: content.header } : {}),
      ...(content.footer ? { footer: content.footer } : {}),
      ...css,
      ...signers,
      ...output,
    };
  }
  const band = (visual: typeof content.header): Band | undefined =>
    visual
      ? {
          height: visual.height,
          html: compileDoc(visual.doc, sections),
          ...(visual.firstPage ? { firstPageHtml: compileDoc(visual.firstPage, sections) } : {}),
        }
      : undefined;
  const header = band(content.header);
  const footer = band(content.footer);
  return {
    html: compileDoc(content.body, sections),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...css,
    ...signers,
    ...output,
  };
}

/** Converts a visual template to code mode (one way, ADR 0016), one top-level block per line. */
export function toCodeMode(
  content: DesignedContent,
  sections: readonly FieldSection[],
): DesignedContent {
  if (content.mode === "code") return content;
  const html = (doc: Doc) => compileDoc(doc, sections, "\n");
  const band = (visual: typeof content.header): Band | null =>
    visual
      ? {
          height: visual.height,
          html: html(visual.doc),
          ...(visual.firstPage ? { firstPageHtml: html(visual.firstPage) } : {}),
        }
      : null;
  return {
    mode: "code",
    body: html(content.body),
    header: band(content.header),
    footer: band(content.footer),
    css: content.css,
    signers: content.signers,
    output: content.output,
  };
}

export type FieldProblem = { field: string; message: string };

/** What field checks need to know about a snippet (docs/features/snippet-library.md). */
export type SnippetRef = { id: string; key: string; name: string; fields: readonly string[] };

/**
 * Field references in a template that don't fit its fields: undeclared keys (e.g. after a
 * rename), group fields outside their repeating section, wrong field types, page tokens outside
 * bands, and fields a used snippet expects but the template lacks. Code mode only gets the
 * snippet check. `snippets` is the library; leave it out to skip snippet checks. The editor flags
 * these; rendering doesn't block on them.
 */
export function templateFieldProblems(
  content: DesignedContent,
  sections: readonly FieldSection[],
  snippets?: readonly SnippetRef[],
): FieldProblem[] {
  const topLevel = new Map(sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const problems: FieldProblem[] = [];
  const flag = (field: string, message: string): void => {
    problems.push({ field, message });
  };

  /** `name` is a snippet id (visual blocks) or key (code). */
  const checkSnippet = (name: string) => {
    if (!snippets) return;
    const found = snippets.find((s) => s.id === name || s.key === name);
    if (!found) return flag(name, `Snippet "${name}" doesn't exist`);
    for (const key of found.fields) {
      if (!topLevel.has(key)) {
        flag(key, `Snippet "${found.name}" expects "${key}", which isn't a declared field`);
      }
    }
  };

  const signerIds = new Set(content.signers.map((s) => s.id));
  const checkSigner = (id: string) => {
    if (!signerIds.has(id)) flag(id, `A sign box is for "${id}", which isn't a signer`);
  };

  if (content.mode === "code") {
    const parts = compiledSources({ ...content, html: content.body });
    for (const name of new Set(parts.flatMap(partialNames))) checkSnippet(name);
    const used = [...content.body.matchAll(/data-signer=["']?(\w+)/g)].map((m) => m[1] ?? "");
    for (const id of new Set(used)) checkSigner(id);
    return problems;
  }

  type Use = "value" | "image" | "condition";
  const check = (path: string, use: Use, repeat: string | null, inBand: boolean) => {
    if (path === "page" || path === "pages") {
      if (!inBand || use !== "value") flag(path, `{{ ${path} }} only works in a header or footer`);
      return;
    }
    const [groupKey = "", key] = path.split(".");
    const top = topLevel.get(groupKey);
    const field =
      key === undefined
        ? top
        : top?.type === "group"
          ? top.fields.find((c) => c.key === key)
          : undefined;
    if (!field) return flag(path, `"${path}" isn't a declared field`);
    if (key !== undefined && groupKey !== repeat) {
      return flag(path, `"${path}" can only be used inside a repeating section over "${groupKey}"`);
    }
    if (use === "image" && field.type !== "image" && field.type !== "signature") {
      return flag(path, `"${path}" isn't an image or signature field`);
    }
    if (use === "value" && field.type === "group") {
      flag(path, `"${path}" is a repeating group; use a repeating section or table row`);
    }
  };
  const checkRepeat = (key: string, repeat: string | null) => {
    if (topLevel.get(key)?.type !== "group") flag(key, `"${key}" isn't a repeating group`);
    if (repeat) flag(key, `Repeating sections can't nest ("${key}" inside "${repeat}")`);
  };

  const walkInline = (
    nodes: readonly InlineNode[] = [],
    repeat: string | null,
    inBand: boolean,
  ) => {
    for (const node of nodes) {
      if (node.type === "mergeField") check(node.attrs.field, "value", repeat, inBand);
      if (node.type === "signBox") {
        checkSigner(node.attrs.signerId);
        if (inBand) flag(node.attrs.signerId, "Sign boxes in a header or footer aren't located");
      }
    }
  };
  const walk = (nodes: readonly BlockNode[], repeat: string | null, inBand: boolean) => {
    for (const node of nodes) {
      switch (node.type) {
        case "paragraph":
        case "heading":
          walkInline(node.content, repeat, inBand);
          break;
        case "bulletList":
        case "orderedList":
          for (const li of node.content) walk(li.content, repeat, inBand);
          break;
        case "blockquote":
          walk(node.content, repeat, inBand);
          break;
        case "image":
          if (node.attrs.field) check(node.attrs.field, "image", repeat, inBand);
          break;
        case "table":
          for (const row of node.content) {
            const rowRepeat = row.attrs?.repeat;
            if (rowRepeat) checkRepeat(rowRepeat, repeat);
            for (const cell of row.content) walk(cell.content, rowRepeat ?? repeat, inBand);
          }
          break;
        case "conditionalSection":
          check(node.attrs.condition.field, "condition", repeat, inBand);
          walk(node.content, repeat, inBand);
          break;
        case "repeatingSection":
          checkRepeat(node.attrs.field, repeat);
          walk(node.content, node.attrs.field, inBand);
          break;
        case "snippet":
          checkSnippet(node.attrs.snippetId);
          break;
        case "horizontalRule":
        case "pageBreak":
        // Raw HTML isn't checked against the fields; publish only checks its Liquid parses.
        case "rawHtml":
          break;
      }
    }
  };

  walk(content.body.content, null, false);
  for (const band of [content.header, content.footer]) {
    if (!band) continue;
    walk(band.doc.content, null, true);
    if (band.firstPage) walk(band.firstPage.content, null, true);
  }
  return problems;
}
