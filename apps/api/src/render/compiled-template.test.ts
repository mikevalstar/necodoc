import {
  type Condition,
  compileDoc,
  conditionSchema,
  docSchema,
  evaluateCondition,
  fieldSectionsSchema,
} from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { liquid } from "./liquid";

// The shared compiler's output, run through the API's real Liquid engine (ADR 0015/0016).

const sections = fieldSectionsSchema.parse([
  {
    title: "S",
    fields: [
      { type: "text", key: "s", label: "S" },
      { type: "number", key: "n", label: "N" },
      { type: "boolean", key: "b", label: "B" },
      {
        type: "choice",
        key: "list",
        label: "List",
        multiple: true,
        options: ["x", "y", "z"].map((v) => ({ value: v, label: v })),
      },
      {
        type: "group",
        key: "items",
        label: "Items",
        fields: [
          { type: "text", key: "name", label: "Name" },
          { type: "number", key: "qty", label: "Qty" },
        ],
      },
    ],
  },
]);

const render = (content: unknown[], data: Record<string, unknown>) =>
  liquid.parseAndRender(compileDoc(docSchema.parse({ type: "doc", content }), sections), data);

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });
const merge = (field: string, filter?: unknown) => ({
  type: "mergeField",
  attrs: { field, filter },
});

describe("compiled templates in Liquid", () => {
  it("escapes merged values and leaves typed Liquid inert", async () => {
    const out = await render([p(text("{{ s }} {% raw %} "), merge("s"))], { s: "<b>&'\"" });
    expect(out).toBe(
      "<p>&#123;&#123; s &#125;&#125; &#123;% raw %&#125; &lt;b&gt;&amp;&#39;&#34;</p>",
    );
  });

  it("applies merge filters", async () => {
    const data = { s: "a\n<b>", n: 1234.5, d: "2026-03-04" };
    const cases: [string, unknown, string][] = [
      ["d", { name: "date", format: "MMM D, YYYY [at] YY" }, "Mar 4, 2026 at 26"],
      ["n", { name: "number", decimals: 2 }, "1,234.50"],
      ["n", { name: "currency", currency: "EUR" }, "€1,234.50"],
      ["s", { name: "upcase" }, "A\n&lt;B&gt;"],
      ["s", { name: "lines" }, "a<br />\n&lt;b&gt;"],
    ];
    for (const [field, filter, expected] of cases) {
      expect(await render([p(merge(field, filter))], data)).toBe(`<p>${expected}</p>`);
    }
  });

  it("repeats sections and table rows per item", async () => {
    const data = {
      s: "Acme",
      items: [
        { name: "A", qty: 1 },
        { name: "B<", qty: 2 },
      ],
    };
    const section = {
      type: "repeatingSection",
      attrs: { field: "items" },
      content: [p(merge("items.name"), text(" for "), merge("s"))],
    };
    expect(await render([section], data)).toBe("<p>A for Acme</p><p>B&lt; for Acme</p>");
    const table = {
      type: "table",
      content: [
        {
          type: "tableRow",
          attrs: { repeat: "items" },
          content: [{ type: "tableCell", content: [p(merge("items.qty"))] }],
        },
      ],
    };
    expect(await render([table], data)).toBe(
      "<table><tbody><tr><td><p>1</p></td></tr><tr><td><p>2</p></td></tr></tbody></table>",
    );
    expect(await render([section], {})).toBe("");
  });

  it("renders field images only when set", async () => {
    const image = { type: "image", attrs: { field: "s" } };
    expect(await render([image], {})).toBe("");
    expect(await render([image], { s: "data:image/png;base64,AA==" })).toBe(
      '<img src="data:image/png;base64,AA==" alt="">',
    );
  });

  // Show-ifs run in the browser (evaluateCondition); conditional sections run in Liquid.
  // They must agree on every value a validated field can hold.
  it("evaluates conditional sections the same way as show-ifs", async () => {
    const values: Record<string, unknown[]> = {
      s: [undefined, "", "a", "b", "it's \"%}", "é ü 😀"],
      n: [undefined, 0, 3, 5, -1.5],
      b: [undefined, true, false],
      list: [undefined, [], ["x"], ["x", "y"], ["z"]],
    };
    const conditions: Condition[] = [
      ...["s", "n", "b", "list"].map((field) => ({ field, op: "is_set" as const })),
      ...["a", "it's \"%}", "é ü 😀"].flatMap((value) => [
        { field: "s", op: "equals" as const, value },
        { field: "s", op: "not_equals" as const, value },
      ]),
      { field: "s", op: "one_of", values: ["a", "b"] },
      { field: "n", op: "equals", value: 3 },
      { field: "n", op: "not_equals", value: 3 },
      { field: "n", op: "one_of", values: [0, 5] },
      { field: "n", op: "gt", value: 2 },
      { field: "n", op: "lt", value: 0 },
      { field: "b", op: "equals", value: true },
      { field: "b", op: "not_equals", value: true },
      { field: "list", op: "equals", value: "x" },
      { field: "list", op: "not_equals", value: "x" },
      { field: "list", op: "one_of", values: ["y", "z"] },
    ].map((c) => conditionSchema.parse(c));

    for (const condition of conditions) {
      for (const value of values[condition.field] ?? []) {
        const data = value === undefined ? {} : { [condition.field]: value };
        const section = {
          type: "conditionalSection",
          attrs: { condition },
          content: [p(text("yes"))],
        };
        const shown = (await render([section], data)) === "<p>yes</p>";
        expect({ condition, value, shown }).toEqual({
          condition,
          value,
          shown: evaluateCondition(condition, data),
        });
      }
    }
  });
});
