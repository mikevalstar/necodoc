import { z } from "zod";

// Spec: docs/features/template-fields-and-guided-form.md. One field definition drives the guided
// form, API validation, the JSON Schema export and sample data.

/** Keys the renderer and the compiled templates own: band page tokens and the repeat item. */
export const RESERVED_FIELD_KEYS = ["page", "pages", "item", "forloop"] as const;

export const fieldKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Use snake_case: lowercase letters, digits and _")
  .max(64)
  .refine((key) => !(RESERVED_FIELD_KEYS as readonly string[]).includes(key), {
    message: `${RESERVED_FIELD_KEYS.join(", ")} are reserved`,
  });

/** `key`, or `group.key` for a field inside a repeating group. */
export const fieldPathSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, "Not a field path");

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/**
 * A show-if rule: one field compared with a value. Structured data, not Liquid, so the browser
 * and the API evaluate it the same way. On a multiple choice value, `equals` means "includes".
 */
export const conditionSchema = z.discriminatedUnion("op", [
  z.object({ field: fieldPathSchema, op: z.enum(["equals", "not_equals"]), value: scalar }),
  z.object({
    field: fieldPathSchema,
    op: z.literal("one_of"),
    values: z.array(z.union([z.string(), z.number()])).min(1),
  }),
  /** Set means not empty: not missing, null, "", false or []. */
  z.object({ field: fieldPathSchema, op: z.literal("is_set") }),
  /** Numbers compare as numbers, strings (ISO dates) as strings; anything else is false. */
  z.object({
    field: fieldPathSchema,
    op: z.enum(["gt", "lt"]),
    value: z.union([z.number(), z.string()]),
  }),
]);
export type Condition = z.infer<typeof conditionSchema>;

const isoDate = z.iso.date();
const count = z.number().int().min(0);

const base = {
  key: fieldKeySchema,
  label: z.string().trim().min(1, "Enter a label").max(200),
  help: z.string().max(1000).optional(),
  required: z.boolean().default(false),
  showIf: conditionSchema.optional(),
  /**
   * Masked outside stored inputs and PDFs (docs/features/personal-data-masking-and-erasure.md).
   * Unset: automatic, by type and key (`isSensitiveField` in privacy.ts).
   */
  sensitive: z.boolean().optional(),
};

const textField = {
  ...base,
  minLength: count.optional(),
  maxLength: count.optional(),
  /** A JavaScript regular expression the whole value must match. */
  pattern: z.string().max(500).optional(),
  default: z.string().optional(),
};

export const choiceOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().trim().min(1).max(200),
});

const scalarFieldSchemas = [
  z.object({ type: z.literal("text"), ...textField }),
  z.object({ type: z.literal("long_text"), ...textField }),
  z.object({
    type: z.literal("number"),
    ...base,
    min: z.number().optional(),
    max: z.number().optional(),
    /** Most decimal places allowed; 0 means whole numbers. */
    decimals: z.number().int().min(0).max(10).optional(),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal("date"),
    ...base,
    min: isoDate.optional(),
    max: isoDate.optional(),
    default: isoDate.optional(),
  }),
  z.object({ type: z.literal("boolean"), ...base, default: z.boolean().optional() }),
  z.object({
    type: z.literal("choice"),
    ...base,
    options: z.array(choiceOptionSchema).min(1, "Add at least one option"),
    multiple: z.boolean().default(false),
    /** Multiple choice only. */
    minItems: count.optional(),
    maxItems: count.optional(),
    /** A value for single choice, a list of values for multiple choice. */
    default: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({ type: z.literal("email"), ...base, default: z.email().optional() }),
  /** Value: a `data:` URL (PNG, JPEG or WebP). */
  z.object({ type: z.literal("image"), ...base }),
  /** Value: a drawn signature as a PNG `data:` URL. */
  z.object({ type: z.literal("signature"), ...base }),
] as const;

/** A field that holds one value; everything except a repeating group. */
export const scalarFieldSchema = z.discriminatedUnion("type", [...scalarFieldSchemas]);
export type ScalarField = z.infer<typeof scalarFieldSchema>;

/** Groups don't nest: their child fields are scalar. Child show-ifs refer to earlier siblings. */
export const groupFieldSchema = z.object({
  type: z.literal("group"),
  ...base,
  fields: z.array(scalarFieldSchema).min(1, "Add at least one field to the group"),
  minItems: count.optional(),
  maxItems: count.optional(),
});
export type GroupField = z.infer<typeof groupFieldSchema>;

const fieldUnion = z.discriminatedUnion("type", [...scalarFieldSchemas, groupFieldSchema]);
export type Field = z.infer<typeof fieldUnion>;
export type FieldType = Field["type"];

export const fieldSectionSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: z.string().max(1000).optional(),
  showIf: conditionSchema.optional(),
  fields: z.array(fieldUnion),
});
export type FieldSection = z.infer<typeof fieldSectionSchema>;

/**
 * A template's fields, in order, grouped into sections (one guided-form step each). Keys are
 * unique, and a show-if may only refer to a field that comes earlier, so visibility resolves in
 * one pass and never loops.
 */
export const fieldSectionsSchema = z.array(fieldSectionSchema).superRefine((sections, ctx) => {
  const issue = (message: string, path: PropertyKey[]) =>
    ctx.addIssue({ code: "custom", message, path });
  const checkCondition = (
    condition: Condition | undefined,
    earlier: ReadonlySet<string>,
    path: PropertyKey[],
  ) => {
    if (condition && !earlier.has(condition.field)) {
      issue(`Show-if must refer to an earlier field; "${condition.field}" isn't one`, [
        ...path,
        "showIf",
        "field",
      ]);
    }
  };
  /** Checks fields in order; `earlier` collects the keys a later show-if may use. */
  const checkFields = (fields: readonly Field[], earlier: Set<string>, path: PropertyKey[]) => {
    fields.forEach((field, i) => {
      const at = [...path, "fields", i];
      if (earlier.has(field.key)) issue(`Duplicate key "${field.key}"`, [...at, "key"]);
      checkCondition(field.showIf, earlier, at);
      for (const { message, path } of fieldIssues(field)) issue(message, [...at, ...path]);
      if (field.type === "group") checkFields(field.fields, new Set(), at);
      earlier.add(field.key);
    });
  };
  const topLevel = new Set<string>();
  sections.forEach((section, s) => {
    checkCondition(section.showIf, topLevel, [s]);
    checkFields(section.fields, topLevel, [s]);
  });
});

type Issue = { message: string; path: PropertyKey[] };

/** Definition problems inside one field: bad ranges, a bad pattern, a default that doesn't fit. */
function fieldIssues(field: Field): Issue[] {
  const issues: Issue[] = [];
  const range = (
    min: number | string | undefined,
    max: number | string | undefined,
    name: string,
  ) => {
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({ message: `Minimum ${name} is above the maximum`, path: [] });
    }
  };
  switch (field.type) {
    case "text":
    case "long_text":
      range(field.minLength, field.maxLength, "length");
      if (field.pattern !== undefined && !compiles(field.pattern)) {
        issues.push({ message: "Not a valid regular expression", path: ["pattern"] });
      }
      break;
    case "number":
    case "date":
      range(field.min, field.max, "value");
      break;
    case "choice": {
      range(field.minItems, field.maxItems, "selection count");
      const values = field.options.map((o) => o.value);
      if (new Set(values).size !== values.length) {
        issues.push({ message: "Option values must be unique", path: ["options"] });
      }
      break;
    }
    case "group":
      range(field.minItems, field.maxItems, "item count");
      break;
  }
  if ("default" in field && field.default !== undefined) {
    const result = fieldValueSchema(field).safeParse(field.default);
    if (!result.success) {
      issues.push({ message: `Default: ${result.error.issues[0]?.message}`, path: ["default"] });
    }
  }
  return issues;
}

function compiles(pattern: string) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Values

/** A submitted value: scalars, multiple choice lists, and repeating group items. */
export type FieldValue = string | number | boolean | string[] | TemplateDataItem[];
export type TemplateDataItem = { [key: string]: Exclude<FieldValue, TemplateDataItem[]> };
export type TemplateData = { [key: string]: FieldValue };

/** Missing, null, "", false and [] count as not set, in show-ifs and for `required`. */
export const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  value === false ||
  (Array.isArray(value) && value.length === 0);

export function evaluateCondition(condition: Condition, data: Readonly<Record<string, unknown>>) {
  const actual = data[condition.field];
  switch (condition.op) {
    case "is_set":
      return !isEmptyValue(actual);
    case "equals":
    case "not_equals": {
      const equal = Array.isArray(actual)
        ? actual.includes(condition.value)
        : actual === condition.value;
      return condition.op === "equals" ? equal : !equal;
    }
    case "one_of":
      return Array.isArray(actual)
        ? actual.some((v) => condition.values.includes(v))
        : condition.values.some((v) => v === actual);
    case "gt":
    case "lt": {
      const { value } = condition;
      const comparable =
        (typeof actual === "number" && typeof value === "number") ||
        (typeof actual === "string" && typeof value === "string");
      if (!comparable) return false;
      return condition.op === "gt" ? actual > value : actual < value;
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A field with every show-if that gates it: its section's and its own. */
type Entry = { field: Field; conditions: Condition[] };

const entries = (fields: readonly Field[], sectionIf?: Condition): Entry[] =>
  fields.map((field) => ({
    field,
    conditions: [sectionIf, field.showIf].filter((c): c is Condition => c !== undefined),
  }));

const sectionEntries = (sections: readonly FieldSection[]) =>
  sections.flatMap((section) => entries(section.fields, section.showIf));

const visible = (entry: Entry, data: Readonly<Record<string, unknown>>) =>
  entry.conditions.every((condition) => evaluateCondition(condition, data));

/**
 * Keeps only visible fields, in order, so a show-if sees earlier values after they were dropped.
 * Empty values become missing, and missing values take the field's default.
 */
function resolveVisible(list: readonly Entry[], raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const entry of list) {
    if (!visible(entry, out)) continue;
    const { field } = entry;
    const given = Object.hasOwn(raw, field.key) ? raw[field.key] : undefined;
    const value = isEmptyValue(given) && field.type !== "boolean" ? undefined : given;
    const resolved = value ?? ("default" in field ? field.default : undefined);
    if (resolved !== undefined && resolved !== null) out[field.key] = resolved;
  }
  return out;
}

const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * The schema of one value. Validation ignores `required` (that depends on visibility); the JSON
 * Schema gets `nonEmpty` for unconditionally required fields, so it refuses what validation would.
 */
function fieldValueSchema(field: Field, mode: Mode = "validate", nonEmpty = false): z.ZodType {
  const schema = valueSchema(field, mode, nonEmpty);
  if (mode === "validate") return schema;
  return schema.meta({ title: field.label, ...(field.help ? { description: field.help } : {}) });
}

type Mode = "validate" | "describe";

/** `nonEmpty`: refuse what isEmptyValue calls empty ("", false, []), as a required field does. */
function valueSchema(field: Field, mode: Mode, nonEmpty = false): z.ZodType {
  switch (field.type) {
    case "text":
    case "long_text": {
      let s = z.string();
      const minLength = field.minLength ?? (nonEmpty ? 1 : undefined);
      if (minLength !== undefined) s = s.min(minLength);
      if (field.maxLength !== undefined) s = s.max(field.maxLength);
      if (field.pattern !== undefined && compiles(field.pattern)) {
        s = s.regex(new RegExp(`^(?:${field.pattern})$`), "Doesn't match the expected format");
      }
      return s;
    }
    case "number": {
      let s = z.number();
      if (field.min !== undefined) s = s.min(field.min);
      if (field.max !== undefined) s = s.max(field.max);
      const { decimals } = field;
      if (decimals === undefined) return s;
      if (decimals === 0) return s.int();
      return s.refine((n) => Number(n.toFixed(decimals)) === n, {
        message: `Use at most ${decimals} decimal places`,
      });
    }
    case "date": {
      const { min, max } = field;
      return isoDate
        .refine((d) => min === undefined || d >= min, { message: `Must be on or after ${min}` })
        .refine((d) => max === undefined || d <= max, { message: `Must be on or before ${max}` });
    }
    case "boolean":
      return nonEmpty ? z.literal(true) : z.boolean();
    case "choice": {
      const values = field.options.map((o) => o.value);
      const one = z.enum(values as [string, ...string[]], { error: "Pick one of the options" });
      if (!field.multiple) return one;
      let list = z.array(one);
      const minItems = field.minItems ?? (nonEmpty ? 1 : undefined);
      if (minItems !== undefined) list = list.min(minItems);
      if (field.maxItems !== undefined) list = list.max(field.maxItems);
      return list.refine((l) => new Set(l).size === l.length, { message: "Pick each option once" });
    }
    case "email":
      return z.email();
    case "image":
      return z.string().regex(DATA_URL, "Upload a PNG, JPEG or WebP image");
    case "signature":
      return z.string().regex(PNG_DATA_URL, "Draw a signature");
    case "group": {
      let list = z.array(objectSchema(entries(field.fields), mode));
      const minItems = field.minItems ?? (nonEmpty ? 1 : undefined);
      if (minItems !== undefined) list = list.min(minItems);
      if (field.maxItems !== undefined) list = list.max(field.maxItems);
      return list;
    }
  }
}

/**
 * Validate: drop hidden fields, then check the rest, requiring the visible required ones.
 * Describe (JSON Schema): no visibility logic, so only unconditional required fields are required.
 */
function objectSchema(list: readonly Entry[], mode: Mode): z.ZodType {
  const shape = Object.fromEntries(
    list.map((entry) => {
      const required = mode === "describe" && entry.field.required && !entry.conditions.length;
      const value = fieldValueSchema(entry.field, mode, required);
      return [entry.field.key, required ? value : value.optional()];
    }),
  );
  const object = z.object(shape);
  if (mode === "describe") return object;
  // A transform rather than preprocess + refine: zod skips an object's refinements once a
  // nested item fails, and the form should show every error at once.
  return z.unknown().transform((input, ctx) => {
    if (!isRecord(input)) {
      ctx.addIssue({ code: "custom", message: "Expected an object" });
      return z.NEVER;
    }
    const data = resolveVisible(list, input);
    const parsed = object.safeParse(data);
    const issues = parsed.success ? [] : [...parsed.error.issues];
    for (const entry of list) {
      // false is empty, so a required boolean is a consent box: it must be ticked.
      if (entry.field.required && visible(entry, data) && isEmptyValue(data[entry.field.key])) {
        issues.push({
          code: "custom",
          message: "Required",
          path: [entry.field.key],
          input: undefined,
        });
      }
    }
    for (const { message, path } of issues) ctx.addIssue({ code: "custom", message, path });
    return parsed.success && !issues.length ? parsed.data : z.NEVER;
  });
}

/**
 * The validator for submitted data. Hidden fields are never required and their values are
 * dropped; unknown keys are dropped; missing values take defaults.
 */
export const templateDataSchema = (sections: readonly FieldSection[]) =>
  objectSchema(sectionEntries(sections), "validate") as z.ZodType<TemplateData, unknown>;

/**
 * JSON Schema (draft 2020-12) for API callers. Show-ifs aren't expressed: conditional fields are
 * optional here, and the API still applies them.
 */
export const templateJsonSchema = (sections: readonly FieldSection[]) =>
  z.toJSONSchema(objectSchema(sectionEntries(sections), "describe"), { io: "input" });

/** Validation errors keyed by field path (`client_name`, `line_items.0.qty`, or "" for the root). */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    out[key] = [...(out[key] ?? []), issue.message];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sample data

/** A 1x1 transparent PNG, for image and signature samples. */
export const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const SAMPLE_DATE = "2026-01-15";

function sampleValue(field: Field): FieldValue {
  if ("default" in field && field.default !== undefined) return field.default;
  switch (field.type) {
    case "text":
    case "long_text": {
      const text =
        field.type === "text"
          ? `Sample ${field.label}`
          : `Sample ${field.label}.\nA second line of example text.`;
      const padded = text.padEnd(field.minLength ?? 0, ".");
      return field.maxLength === undefined ? padded : padded.slice(0, field.maxLength);
    }
    case "number": {
      const n = Math.min(Math.max(42, field.min ?? -Infinity), field.max ?? Infinity);
      return field.decimals === 0 ? Math.ceil(n) : n;
    }
    case "date":
      return field.min ?? field.max ?? SAMPLE_DATE;
    case "boolean":
      return true;
    case "choice": {
      const values = field.options.map((o) => o.value);
      return field.multiple ? values.slice(0, Math.max(1, field.minItems ?? 1)) : (values[0] ?? "");
    }
    case "email":
      return "jane.doe@example.com";
    case "image":
    case "signature":
      return SAMPLE_PNG;
    case "group": {
      const items = Math.min(Math.max(2, field.minItems ?? 0), field.maxItems ?? Infinity);
      return Array.from({ length: items }, () => sampleObject(field.fields) as TemplateDataItem);
    }
  }
}

function sampleObject(fields: readonly Field[]) {
  return Object.fromEntries(fields.map((field) => [field.key, sampleValue(field)]));
}

/**
 * Plausible values for every field ("Fill with examples"). Defaults win. Text with a pattern
 * can't be generated and may need editing.
 */
export const sampleTemplateData = (sections: readonly FieldSection[]): TemplateData =>
  sampleObject(sections.flatMap((s) => s.fields));
