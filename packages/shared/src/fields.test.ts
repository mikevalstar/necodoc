import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  evaluateCondition,
  type FieldSection,
  fieldErrors,
  fieldSectionsSchema,
  SAMPLE_PNG,
  sampleTemplateData,
  templateDataSchema,
  templateJsonSchema,
} from "./fields";

const sections = (input: unknown): FieldSection[] => fieldSectionsSchema.parse(input);

const quote = sections([
  {
    title: "Client",
    fields: [
      { type: "text", key: "client_name", label: "Client name", required: true, maxLength: 50 },
      { type: "email", key: "email", label: "Email" },
      {
        type: "choice",
        key: "client_type",
        label: "Client type",
        required: true,
        options: [
          { value: "person", label: "Person" },
          { value: "business", label: "Business" },
        ],
      },
      {
        type: "text",
        key: "company",
        label: "Company",
        required: true,
        showIf: { field: "client_type", op: "equals", value: "business" },
      },
    ],
  },
  {
    title: "Items",
    fields: [
      {
        type: "group",
        key: "line_items",
        label: "Line items",
        required: true,
        maxItems: 3,
        fields: [
          { type: "text", key: "description", label: "Description", required: true },
          { type: "number", key: "qty", label: "Qty", required: true, min: 1, decimals: 0 },
          { type: "boolean", key: "discounted", label: "Discounted" },
          {
            type: "number",
            key: "discount",
            label: "Discount %",
            required: true,
            decimals: 2,
            showIf: { field: "discounted", op: "is_set" },
          },
        ],
      },
    ],
  },
  {
    title: "Extras",
    showIf: { field: "client_type", op: "equals", value: "business" },
    fields: [
      { type: "text", key: "po_number", label: "PO number", required: true, pattern: "PO-\\d+" },
    ],
  },
]);

const parse = (data: unknown) => templateDataSchema(quote).safeParse(data);
const errorsOf = (data: unknown) => {
  const result = parse(data);
  return result.success ? {} : fieldErrors(result.error);
};

const person = {
  client_name: "Ada",
  client_type: "person",
  line_items: [{ description: "Widget", qty: 2 }],
};

describe("fieldSectionsSchema", () => {
  const field = (extra: object) => [{ title: "S", fields: [{ key: "a", label: "A", ...extra }] }];
  const issues = (input: unknown) => {
    const result = fieldSectionsSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.message);
  };

  it("accepts every field type", () => {
    const all = [
      { type: "text", key: "t", label: "T" },
      { type: "long_text", key: "lt", label: "LT" },
      { type: "number", key: "n", label: "N" },
      { type: "date", key: "d", label: "D", min: "2026-01-01" },
      { type: "boolean", key: "b", label: "B" },
      { type: "choice", key: "c", label: "C", options: [{ value: "x", label: "X" }] },
      { type: "email", key: "e", label: "E" },
      { type: "image", key: "i", label: "I" },
      { type: "signature", key: "s", label: "S" },
      { type: "group", key: "g", label: "G", fields: [{ type: "text", key: "t", label: "T" }] },
    ];
    expect(issues([{ title: "All", fields: all }])).toEqual([]);
  });

  it("rejects bad keys, reserved keys and duplicates", () => {
    expect(issues(field({ type: "text", key: "Bad-Key" }))[0]).toMatch(/snake_case/);
    expect(issues(field({ type: "text", key: "page" }))[0]).toMatch(/reserved/);
    expect(issues(field({ type: "text", key: "item" }))[0]).toMatch(/reserved/);
    const dup = [
      { title: "A", fields: [{ type: "text", key: "x", label: "X" }] },
      { title: "B", fields: [{ type: "number", key: "x", label: "X" }] },
    ];
    expect(issues(dup)).toEqual(['Duplicate key "x"']);
  });

  it("allows the same key in a group and at the top level, not twice in a group", () => {
    const fields = [
      { type: "text", key: "name", label: "Name" },
      {
        type: "group",
        key: "g",
        label: "G",
        fields: [
          { type: "text", key: "name", label: "Name" },
          { type: "text", key: "name", label: "Again" },
        ],
      },
    ];
    expect(issues([{ title: "S", fields }])).toEqual(['Duplicate key "name"']);
  });

  it("rejects nested groups", () => {
    const inner = {
      type: "group",
      key: "inner",
      label: "I",
      fields: [{ type: "text", key: "t", label: "T" }],
    };
    expect(issues(field({ type: "group", fields: [inner] })).length).toBeGreaterThan(0);
  });

  it("requires show-ifs to refer to an earlier field in scope", () => {
    const forward = [
      {
        title: "S",
        fields: [
          { type: "text", key: "a", label: "A", showIf: { field: "b", op: "is_set" } },
          { type: "text", key: "b", label: "B" },
        ],
      },
    ];
    expect(issues(forward)[0]).toMatch(/earlier field; "b"/);
    const self = field({ type: "text", showIf: { field: "a", op: "is_set" } });
    expect(issues(self)[0]).toMatch(/earlier field/);
    const sectionOnLaterField = [
      {
        title: "S",
        showIf: { field: "a", op: "is_set" },
        fields: [{ type: "text", key: "a", label: "A" }],
      },
    ];
    expect(issues(sectionOnLaterField)[0]).toMatch(/earlier field/);
    const childOnTopLevel = [
      {
        title: "S",
        fields: [
          { type: "boolean", key: "top", label: "Top" },
          {
            type: "group",
            key: "g",
            label: "G",
            fields: [
              { type: "text", key: "t", label: "T", showIf: { field: "top", op: "is_set" } },
            ],
          },
        ],
      },
    ];
    expect(issues(childOnTopLevel)[0]).toMatch(/earlier field/);
  });

  it("checks ranges, patterns, options and defaults", () => {
    expect(issues(field({ type: "text", minLength: 5, maxLength: 2 }))).toEqual([
      "Minimum length is above the maximum",
    ]);
    expect(issues(field({ type: "date", min: "2026-02-01", max: "2026-01-01" }))).toEqual([
      "Minimum value is above the maximum",
    ]);
    expect(issues(field({ type: "text", pattern: "(" }))).toEqual([
      "Not a valid regular expression",
    ]);
    const dupOptions = {
      type: "choice",
      options: [
        { value: "x", label: "X" },
        { value: "x", label: "Y" },
      ],
    };
    expect(issues(field(dupOptions))).toEqual(["Option values must be unique"]);
    expect(issues(field({ type: "choice", options: [] }))[0]).toMatch(/at least one option/);
    expect(issues(field({ type: "number", max: 3, default: 5 }))[0]).toMatch(/^Default:/);
    const badDefault = { type: "choice", options: [{ value: "x", label: "X" }], default: "nope" };
    expect(issues(field(badDefault))[0]).toMatch(/^Default:/);
    const multiDefault = { ...badDefault, multiple: true, default: ["x"] };
    expect(issues(field(multiDefault))).toEqual([]);
  });

  it("puts issues at the offending path", () => {
    const result = fieldSectionsSchema.safeParse(field({ type: "text", pattern: "(" }));
    expect(result.success || result.error.issues[0]?.path).toEqual([0, "fields", 0, "pattern"]);
  });
});

describe("evaluateCondition", () => {
  const data = { s: "a", n: 5, d: "2026-03-01", list: ["x", "y"], f: false, empty: "", none: [] };
  const holds = (condition: unknown) => evaluateCondition(z.any().parse(condition), data);

  it("compares scalars", () => {
    expect(holds({ field: "s", op: "equals", value: "a" })).toBe(true);
    expect(holds({ field: "s", op: "equals", value: "A" })).toBe(false);
    expect(holds({ field: "n", op: "equals", value: "5" })).toBe(false);
    expect(holds({ field: "s", op: "not_equals", value: "b" })).toBe(true);
    expect(holds({ field: "missing", op: "not_equals", value: "b" })).toBe(true);
    expect(holds({ field: "s", op: "one_of", values: ["b", "a"] })).toBe(true);
    expect(holds({ field: "n", op: "one_of", values: [1, 2] })).toBe(false);
  });

  it("treats list values as 'includes'", () => {
    expect(holds({ field: "list", op: "equals", value: "y" })).toBe(true);
    expect(holds({ field: "list", op: "not_equals", value: "y" })).toBe(false);
    expect(holds({ field: "list", op: "one_of", values: ["z", "x"] })).toBe(true);
    expect(holds({ field: "list", op: "one_of", values: ["z"] })).toBe(false);
  });

  it("checks is_set", () => {
    for (const field of ["s", "n", "list"]) expect(holds({ field, op: "is_set" })).toBe(true);
    for (const field of ["f", "empty", "none", "missing"])
      expect(holds({ field, op: "is_set" })).toBe(false);
  });

  it("orders numbers and strings, never mixed", () => {
    expect(holds({ field: "n", op: "gt", value: 4 })).toBe(true);
    expect(holds({ field: "n", op: "lt", value: 5 })).toBe(false);
    expect(holds({ field: "d", op: "gt", value: "2026-02-28" })).toBe(true);
    expect(holds({ field: "n", op: "gt", value: "4" })).toBe(false);
    expect(holds({ field: "missing", op: "lt", value: 10 })).toBe(false);
  });
});

describe("templateDataSchema", () => {
  it("accepts valid data and drops unknown keys", () => {
    const result = parse({ ...person, extra: "x" });
    expect(result.success && result.data).toEqual(person);
  });

  it("reports errors keyed by field path", () => {
    expect(
      errorsOf({
        client_name: "",
        client_type: "robot",
        line_items: [{ description: "W", qty: 0.5 }],
      }),
    ).toEqual({
      client_name: ["Required"],
      client_type: ["Pick one of the options"],
      "line_items.0.qty": expect.arrayContaining([expect.stringMatching(/expected int/)]),
    });
  });

  it("enforces types and per-type validation", () => {
    expect(errorsOf({ ...person, email: "nope" })).toHaveProperty("email");
    expect(errorsOf({ ...person, client_name: "x".repeat(51) })).toHaveProperty("client_name");
    expect(errorsOf({ ...person, client_name: 7 })).toHaveProperty("client_name");
    const four = Array.from({ length: 4 }, () => ({ description: "W", qty: 1 }));
    expect(errorsOf({ ...person, line_items: four })).toHaveProperty("line_items");
    expect(errorsOf({ ...person, line_items: "nope" })).toHaveProperty("line_items");
  });

  it("requires a required group to have an item", () => {
    expect(errorsOf({ ...person, line_items: [] })).toEqual({ line_items: ["Required"] });
  });

  it("requires a field only while it is visible, and drops hidden values", () => {
    expect(errorsOf({ ...person, client_type: "business" })).toEqual({
      company: ["Required"],
      po_number: ["Required"],
    });
    const hidden = parse({ ...person, company: "Ignored Ltd", po_number: "garbage" });
    expect(hidden.success && hidden.data).toEqual(person);
  });

  it("checks patterns as whole-value matches", () => {
    const business = { ...person, client_type: "business", company: "Acme" };
    expect(errorsOf({ ...business, po_number: "PO-12" })).toEqual({});
    expect(errorsOf({ ...business, po_number: "xPO-12" })).toHaveProperty("po_number");
    expect(errorsOf({ ...business, po_number: "PO-12x" })).toHaveProperty("po_number");
  });

  it("applies show-ifs inside group items against siblings", () => {
    const items = [
      { description: "A", qty: 1, discounted: true },
      { description: "B", qty: 1, discounted: false, discount: 99 },
      { description: "C", qty: 1, discounted: true, discount: 10.5 },
    ];
    expect(errorsOf({ ...person, line_items: items })).toEqual({
      "line_items.0.discount": ["Required"],
    });
    const ok = parse({ ...person, line_items: items.slice(1) });
    expect(ok.success && ok.data.line_items).toEqual([
      { description: "B", qty: 1, discounted: false },
      { description: "C", qty: 1, discounted: true, discount: 10.5 },
    ]);
  });

  it("checks decimals", () => {
    const item = (discount: number) => ({ description: "A", qty: 1, discounted: true, discount });
    expect(errorsOf({ ...person, line_items: [item(1.25)] })).toEqual({});
    expect(errorsOf({ ...person, line_items: [item(1.255)] })).toHaveProperty(
      "line_items.0.discount",
    );
  });

  it("cascades: a field shown by a hidden field is hidden too", () => {
    const chain = sections([
      {
        title: "S",
        fields: [
          { type: "boolean", key: "a", label: "A" },
          { type: "text", key: "b", label: "B", showIf: { field: "a", op: "is_set" } },
          {
            type: "text",
            key: "c",
            label: "C",
            required: true,
            showIf: { field: "b", op: "is_set" },
          },
        ],
      },
    ]);
    const result = templateDataSchema(chain).safeParse({ a: false, b: "set", c: "" });
    expect(result.success && result.data).toEqual({ a: false });
  });

  it("treats empty values as missing and fills defaults", () => {
    const withDefaults = sections([
      {
        title: "S",
        fields: [
          { type: "text", key: "city", label: "City", default: "Toronto" },
          { type: "number", key: "n", label: "N" },
          { type: "boolean", key: "b", label: "B" },
          {
            type: "choice",
            key: "c",
            label: "C",
            multiple: true,
            required: true,
            options: [{ value: "x", label: "X" }],
          },
        ],
      },
    ]);
    const schema = templateDataSchema(withDefaults);
    const result = schema.safeParse({ city: "", n: null, b: false, c: ["x"] });
    expect(result.success && result.data).toEqual({ city: "Toronto", b: false, c: ["x"] });
    const empty = schema.safeParse({ c: [] });
    expect(empty.success || fieldErrors(empty.error)).toEqual({ c: ["Required"] });
  });

  it("requires a required boolean to be ticked", () => {
    const consent = sections([
      { title: "S", fields: [{ type: "boolean", key: "agree", label: "I agree", required: true }] },
    ]);
    expect(templateDataSchema(consent).safeParse({ agree: false }).success).toBe(false);
    expect(templateDataSchema(consent).safeParse({ agree: true }).success).toBe(true);
  });

  it("checks multiple choice values, counts and duplicates", () => {
    const multi = sections([
      {
        title: "S",
        fields: [
          {
            type: "choice",
            key: "c",
            label: "C",
            multiple: true,
            maxItems: 2,
            options: ["a", "b", "c"].map((v) => ({ value: v, label: v })),
          },
        ],
      },
    ]);
    const ok = (c: unknown) => templateDataSchema(multi).safeParse({ c }).success;
    expect(ok(["a", "b"])).toBe(true);
    expect(ok(["a", "b", "c"])).toBe(false);
    expect(ok(["a", "a"])).toBe(false);
    expect(ok(["z"])).toBe(false);
    expect(ok("a")).toBe(false);
  });

  it("checks dates, images and signatures", () => {
    const media = sections([
      {
        title: "S",
        fields: [
          { type: "date", key: "d", label: "D", min: "2026-01-01", max: "2026-12-31" },
          { type: "image", key: "img", label: "Img" },
          { type: "signature", key: "sig", label: "Sig" },
        ],
      },
    ]);
    const ok = (data: object) => templateDataSchema(media).safeParse(data).success;
    expect(ok({ d: "2026-06-01" })).toBe(true);
    expect(ok({ d: "2025-12-31" })).toBe(false);
    expect(ok({ d: "2027-01-01" })).toBe(false);
    expect(ok({ d: "June 1" })).toBe(false);
    expect(ok({ img: SAMPLE_PNG, sig: SAMPLE_PNG })).toBe(true);
    expect(ok({ img: "data:image/jpeg;base64,AAAA" })).toBe(true);
    expect(ok({ img: "data:image/svg+xml;base64,AAAA" })).toBe(false);
    expect(ok({ img: "https://example.com/x.png" })).toBe(false);
    expect(ok({ sig: "data:image/jpeg;base64,AAAA" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(errorsOf("nope")).toHaveProperty([""]);
    expect(errorsOf(null)).toHaveProperty([""]);
  });
});

describe("templateJsonSchema", () => {
  const schema = templateJsonSchema(quote);

  it("describes fields with titles, types and only unconditional required fields", () => {
    expect(schema.required).toEqual(["client_name", "client_type", "line_items"]);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.client_name).toMatchObject({
      type: "string",
      title: "Client name",
      maxLength: 50,
    });
    expect(props.client_type).toMatchObject({ enum: ["person", "business"] });
    expect(props.email).toMatchObject({ format: "email" });
    expect(props.line_items).toMatchObject({
      type: "array",
      maxItems: 3,
      items: { type: "object", required: ["description", "qty"] },
    });
  });

  it("refuses empty values for required fields, as validation does", () => {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.client_name).toMatchObject({ minLength: 1 });
    expect(props.line_items).toMatchObject({ minItems: 1 });
    expect(props.email).not.toHaveProperty("minLength");
    const consent = templateJsonSchema(
      sections([
        { title: "S", fields: [{ type: "boolean", key: "ok", label: "OK", required: true }] },
      ]),
    );
    expect((consent.properties as Record<string, unknown>).ok).toMatchObject({ const: true });
  });

  it("serialises as JSON", () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe("sampleTemplateData", () => {
  it("produces data the validator accepts", () => {
    const sample = sampleTemplateData(quote);
    expect(parse(sample).success).toBe(true);
    expect(sample.line_items).toHaveLength(2);
  });

  it("respects defaults, ranges and lengths", () => {
    const fields = sections([
      {
        title: "S",
        fields: [
          { type: "text", key: "short", label: "A very long label indeed", maxLength: 5 },
          { type: "text", key: "long", label: "L", minLength: 30 },
          { type: "number", key: "n", label: "N", min: 100.5, decimals: 0 },
          { type: "number", key: "m", label: "M", max: 3 },
          { type: "date", key: "d", label: "D", min: "2030-01-01" },
          { type: "text", key: "def", label: "Def", default: "kept" },
          {
            type: "choice",
            key: "c",
            label: "C",
            multiple: true,
            minItems: 2,
            options: ["a", "b", "c"].map((v) => ({ value: v, label: v })),
          },
          { type: "signature", key: "sig", label: "Sig" },
        ],
      },
    ]);
    const sample = sampleTemplateData(fields);
    expect(sample).toMatchObject({
      short: "Sampl",
      n: 101,
      m: 3,
      d: "2030-01-01",
      def: "kept",
      c: ["a", "b"],
    });
    expect(String(sample.long).length).toBe(30);
    expect(templateDataSchema(fields).safeParse(sample).success).toBe(true);
  });
});
