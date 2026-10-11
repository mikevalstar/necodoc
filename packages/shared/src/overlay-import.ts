import type { Field, FieldSection } from "./fields";
import { RESERVED_FIELD_KEYS, scalarFieldSchema } from "./fields";
import {
  type AcroField,
  type DetectedField,
  newBoxId,
  type OverlayBox,
  type OverlayBoxInput,
  overlayBoxSchema,
} from "./overlay";

// Spec: docs/features/pdf-overlay-templates.md (AcroForm import, AI auto-detect). Both turn
// something found on the PDF into a box plus, when its key is new, a template field.

const STOP_WORDS = new Set(
  "a an and as at by for from in is of on or the this that to we with enter your".split(" "),
);
/** Names PDF tools make up: Text1, Field 23, CheckBox4, undefined_2, a bare "20". */
const GENERIC_NAME =
  /^(text|field|textfield|fill|check ?box|box|untitled|undefined|button)?[\s_-]*\d*$/i;

/** A snake_case field key from a name or label: the last few meaningful words. */
export function fieldKeyFrom(text: string, fallback = "field"): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // Auto-named fields are often the whole sentence before the blank; its end names the blank.
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  const picked = (meaningful.length ? meaningful : words).slice(-4);
  let key = picked.join("_").slice(0, 48).replace(/_+$/, "");
  if (!/^[a-z]/.test(key)) key = key ? `${fallback}_${key}` : fallback;
  return (RESERVED_FIELD_KEYS as readonly string[]).includes(key) ? `${key}_value` : key;
}

/** "principal_name" → "Principal name". */
const labelFromKey = (key: string) =>
  (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, " ");

/** An AcroForm name's own part: `form1[0].Page1[0].PrincipalName[0]` → `PrincipalName`. */
const ownName = (name: string) =>
  name
    .replace(/\[\d+\]/g, "")
    .split(".")
    .at(-1)
    ?.trim() ?? "";

function uniqueKey(key: string, taken: Set<string>) {
  let unique = key;
  for (let n = 2; taken.has(unique); n++) unique = `${key}_${n}`;
  taken.add(unique);
  return unique;
}

const isDate = (text: string) => /\bdates?\b/i.test(text);

/** A sensible size for text in a box this tall. */
const fontSizeFor = (height: number) =>
  Math.round(Math.min(11, Math.max(6, height * 0.65)) * 2) / 2;

type Proposal = { box: OverlayBox; field: Field | null };

/** One AcroForm field as a box (filling it by name) and a template field. */
function fromAcroField(field: AcroField, taken: Set<string>): Proposal | null {
  if (field.type === "button" || field.readOnly) return null;
  const own = ownName(field.name);
  const label =
    field.label && field.label.length <= 60 && !GENERIC_NAME.test(field.label) ? field.label : null;
  const source = !GENERIC_NAME.test(own) ? own : (label ?? "");
  const fallback = field.type === "checkbox" ? "checkbox" : "field";
  const key = uniqueKey(fieldKeyFrom(source, fallback), taken);
  const base = { key, label: label ?? labelFromKey(key), required: false };
  const at = { id: newBoxId(), page: field.page, rect: field.rect, acroField: field.name };
  const text = (type: "text" | "multiline" | "date", value: string): OverlayBoxInput => ({
    type,
    ...at,
    value,
    style: { size: fontSizeFor(field.rect.height) },
  });
  const date = isDate(`${own} ${field.label ?? ""}`);
  switch (field.type) {
    case "checkbox":
      return {
        box: overlayBoxSchema.parse({ type: "checkbox", ...at, value: `{{ ${key} }}` }),
        field: { type: "boolean", ...base },
      };
    case "radio":
    case "choice":
      return {
        box: overlayBoxSchema.parse(text("text", `{{ ${key} }}`)),
        field: field.options.length
          ? {
              type: "choice",
              ...base,
              options: field.options.map((value) => ({ value, label: value })),
              multiple: false,
            }
          : { type: "text", ...base },
      };
    case "signature":
      // Signature fields can't be filled with a value: draw the signature over it instead.
      return {
        box: overlayBoxSchema.parse({
          type: "signature",
          id: at.id,
          page: at.page,
          rect: at.rect,
          value: `{{ ${key} }}`,
        }),
        field: { type: "signature", ...base },
      };
    case "text":
      if (date && !field.multiline) {
        return {
          box: overlayBoxSchema.parse(text("date", `{{ ${key} | date: "MM/DD/YYYY" }}`)),
          field: { type: "date", ...base },
        };
      }
      return {
        box: overlayBoxSchema.parse(text(field.multiline ? "multiline" : "text", `{{ ${key} }}`)),
        field: {
          type: field.multiline ? "long_text" : "text",
          ...base,
          ...(field.maxLength ? { maxLength: field.maxLength } : {}),
        },
      };
  }
}

/** Adds fields to a section with this title (made if missing), after any already there. */
function addToSection(sections: readonly FieldSection[], title: string, fields: Field[]) {
  if (!fields.length) return [...sections];
  const at = sections.findIndex((s) => s.title === title);
  if (at < 0) return [...sections, { title, fields }];
  return sections.map((s, i) => (i === at ? { ...s, fields: [...s.fields, ...fields] } : s));
}

const allKeys = (sections: readonly FieldSection[]) =>
  new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));

/**
 * AcroForm import: every fillable form field not already mapped by a box becomes a box that
 * fills it by name, plus a new field in a "Form fields" section.
 */
export function importAcroFields(
  fields: readonly AcroField[],
  sections: readonly FieldSection[],
  boxes: readonly OverlayBox[],
) {
  const mapped = new Set(boxes.flatMap((b) => (b.acroField ? [b.acroField] : [])));
  const taken = allKeys(sections);
  const proposals = fields
    .filter((f) => !mapped.has(f.name))
    .flatMap((f) => fromAcroField(f, taken) ?? []);
  return {
    boxes: [...boxes, ...proposals.map((p) => p.box)],
    sections: addToSection(
      sections,
      "Form fields",
      proposals.flatMap((p) => p.field ?? []),
    ),
    added: proposals.length,
  };
}

const fieldTypeFor = {
  text: "text",
  multiline: "long_text",
  number: "number",
  date: "date",
  checkbox: "boolean",
  signature: "signature",
  image: "image",
  qrcode: "text",
  barcode: "text",
} as const satisfies Record<OverlayBox["type"], Field["type"]>;

/** The value expression a box of this type gets when bound to a field. */
const valueFor = (type: OverlayBox["type"], key: string) =>
  type === "date" ? `{{ ${key} | date: "MM/DD/YYYY" }}` : `{{ ${key} }}`;

/**
 * "Create a field for this box": a field of the matching type, keyed from its label, added to
 * the last section (or a new "Fields" section), and the box bound to it.
 */
export function bindNewField(box: OverlayBox, label: string, sections: readonly FieldSection[]) {
  const key = uniqueKey(fieldKeyFrom(label), allKeys(sections));
  const field = scalarFieldSchema.parse({
    type: fieldTypeFor[box.type],
    key,
    label: label.trim() || labelFromKey(key),
  });
  const last = sections.at(-1);
  return {
    box: { ...box, value: valueFor(box.type, key) },
    sections: last
      ? addToSection(sections, last.title, [field])
      : addToSection(sections, "Fields", [field]),
  };
}

/** The box an accepted AI suggestion becomes; its key binds to an existing field or a new one. */
function fromSuggestion(s: DetectedField): OverlayBox {
  const at = { id: newBoxId(), page: s.page, rect: s.rect };
  switch (s.type) {
    case "checkbox":
      return overlayBoxSchema.parse({ type: "checkbox", ...at, value: `{{ ${s.key} }}` });
    case "signature":
    case "image":
      return overlayBoxSchema.parse({ type: s.type, ...at, value: `{{ ${s.key} }}` });
    case "date":
      return overlayBoxSchema.parse({
        type: "date",
        ...at,
        value: `{{ ${s.key} | date: "MM/DD/YYYY" }}`,
        style: { size: fontSizeFor(s.rect.height) },
      });
    default:
      return overlayBoxSchema.parse({
        type: s.type,
        ...at,
        value: `{{ ${s.key} }}`,
        style: { size: fontSizeFor(s.type === "multiline" ? 16 : s.rect.height) },
      });
  }
}

/**
 * Accepted AI suggestions become boxes. A suggestion whose key matches an existing field binds
 * to it; new keys become fields in a "Detected fields" section (once each, so a datum the model
 * found twice fills both boxes).
 */
export function acceptSuggestions(
  suggestions: readonly DetectedField[],
  sections: readonly FieldSection[],
  boxes: readonly OverlayBox[],
) {
  const known = allKeys(sections);
  const added = new Map<string, Field>();
  const accepted = suggestions.map((s) => {
    const key = fieldKeyFrom(s.key);
    if (!known.has(key) && !added.has(key)) {
      added.set(
        key,
        scalarFieldSchema.parse({
          type: fieldTypeFor[s.type],
          key,
          label: s.label || labelFromKey(key),
        }),
      );
    }
    return fromSuggestion({ ...s, key });
  });
  return {
    boxes: [...boxes, ...accepted],
    sections: addToSection(sections, "Detected fields", [...added.values()]),
  };
}
