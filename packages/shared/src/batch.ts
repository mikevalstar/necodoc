import { z } from "zod";
import type { Field, FieldSection } from "./fields";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs).

/** One batch is one insert of generations; bigger runs split into several batches. */
export const MAX_BATCH_ROWS = 10_000;

const filename = z.string().trim().min(1).max(200).optional();

/** JSON batches: one data object per document. */
export const batchJsonSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "Send at least one row")
    .max(MAX_BATCH_ROWS),
  /** Base filename; each row's PDF gets its row number appended. */
  filename,
});
export type BatchJson = z.infer<typeof batchJsonSchema>;

/** CSV column → field path (`key`, or `group.0.key` for the first item of a repeating group). */
export const csvMappingSchema = z.record(
  z.string(),
  z.string().regex(/^[a-z][a-z0-9_]*(\.\d+\.[a-z][a-z0-9_]*)?$/, "Not a field path"),
);
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export const batchStatusSchema = z.enum(["running", "completed", "cancelled"]);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const batchSummarySchema = z.object({
  id: z.uuid(),
  templateId: z.uuid().nullable(),
  templateVersionId: z.uuid().nullable(),
  templateName: z.string(),
  version: z.number().int(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  status: batchStatusSchema,
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  cancelled: z.number().int(),
  createdAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type BatchSummary = z.infer<typeof batchSummarySchema>;

/** Derived, never stored: a batch is finished when no row is left to run. */
export function batchStatus(b: {
  cancelledAt: unknown;
  total: number;
  done: number;
  failed: number;
  cancelled: number;
}): BatchStatus {
  if (b.cancelledAt) return "cancelled";
  return b.done + b.failed + b.cancelled >= b.total ? "completed" : "running";
}

// ---------------------------------------------------------------------------------------------
// CSV

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (rows: readonly (readonly unknown[])[]) =>
  rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

/** The paths a CSV column can fill: scalar fields, and the first item of each repeating group. */
export function csvFieldTargets(sections: readonly FieldSection[]) {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) =>
      field.type === "group"
        ? field.fields.map((child) => ({ path: `${field.key}.0.${child.key}`, field: child }))
        : [{ path: field.key, field }],
    ),
  );
}

/**
 * Columns named like a field path map to it by default: `key`, `group.N.key` for item N, and
 * `group.key` for the first item.
 */
export function defaultCsvMapping(
  header: readonly string[],
  sections: readonly FieldSection[],
): CsvMapping {
  const byName = new Map(
    csvFieldTargets(sections).flatMap(({ path }) => [
      [path, path],
      [path.replace(".0.", "."), path],
    ]),
  );
  return Object.fromEntries(
    header.flatMap((column) => {
      const name = column.trim();
      const item = /^([a-z][a-z0-9_]*)\.(\d+)\.([a-z][a-z0-9_]*)$/.exec(name);
      const path = item ? byName.has(`${item[1]}.0.${item[3]}`) && name : byName.get(name);
      return path ? [[column, path]] : [];
    }),
  );
}

function findField(sections: readonly FieldSection[], path: string): Field | undefined {
  const [key, index, child] = path.split(".");
  const top = sections.flatMap((s) => s.fields).find((f) => f.key === key);
  if (index === undefined) return top?.type === "group" ? undefined : top;
  return top?.type === "group" ? top.fields.find((f) => f.key === child) : undefined;
}

const TRUE = new Set(["true", "yes", "y", "1", "x"]);
const FALSE = new Set(["false", "no", "n", "0"]);

/** A cell as its field expects it. Values that don't convert stay strings, so validation names them. */
function coerce(field: Field | undefined, cell: string): unknown {
  const text = cell.trim();
  if (text === "") return undefined;
  switch (field?.type) {
    case "number": {
      const n = Number(text);
      return Number.isFinite(n) ? n : text;
    }
    case "boolean": {
      const lower = text.toLowerCase();
      return TRUE.has(lower) ? true : FALSE.has(lower) ? false : text;
    }
    case "choice":
      return field.multiple
        ? text
            .split(";")
            .map((v) => v.trim())
            .filter(Boolean)
        : text;
    default:
      return cell;
  }
}

/**
 * CSV rows (header first) to one data object per row, through the column mapping. Empty cells
 * are left out so defaults apply; group items with no values are dropped.
 */
export function csvToRows(
  csv: readonly (readonly string[])[],
  mapping: CsvMapping,
  sections: readonly FieldSection[],
): Record<string, unknown>[] {
  const [header = [], ...body] = csv;
  const columns = header.flatMap((name, i) => {
    const path = mapping[name];
    if (!path) return [];
    const [key = "", index, child] = path.split(".");
    return [
      {
        i,
        key,
        item: index === undefined ? null : { index: Number(index), child: child ?? "" },
        field: findField(sections, path),
      },
    ];
  });
  return body.map((cells) => {
    const data: Record<string, unknown> = {};
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const { i, key, item, field } of columns) {
      const value = coerce(field, cells[i] ?? "");
      if (value === undefined) continue;
      if (!item) {
        data[key] = value;
        continue;
      }
      const items = groups.get(key) ?? [];
      groups.set(key, items);
      items[item.index] = { ...items[item.index], [item.child]: value };
    }
    for (const [key, items] of groups) data[key] = items.filter(Boolean);
    return data;
  });
}
