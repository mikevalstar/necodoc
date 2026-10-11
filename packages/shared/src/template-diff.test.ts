import { describe, expect, it } from "vitest";
import { fieldSectionsSchema } from "./fields";
import { overlayContentSchema } from "./overlay";
import { pageOptionsSchema } from "./render";
import { designedContentSchema } from "./template";
import {
  type DiffableTemplate,
  diffLines,
  diffSequence,
  stableStringify,
  summarizeTemplateDiff,
  templateDiff,
} from "./template-diff";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const designed = (
  blocks: unknown[],
  overrides: Partial<DiffableTemplate> = {},
): DiffableTemplate => ({
  kind: "designed",
  name: "Bond",
  description: "",
  sections: fieldSectionsSchema.parse([
    {
      title: "Parties",
      fields: [
        { type: "text", key: "principal", label: "Principal" },
        { type: "number", key: "amount", label: "Amount" },
      ],
    },
  ]),
  sampleData: {},
  page: pageOptionsSchema.parse({}),
  themeId: null,
  theme: null,
  content: designedContentSchema.parse({ mode: "visual", body: { type: "doc", content: blocks } }),
  ...overrides,
});

describe("diffSequence", () => {
  it("finds the longest common subsequence", () => {
    const ops = diffSequence(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"], (s) => s);
    expect(ops.map((o) => `${o.op[0]}${o.item}`)).toEqual(["ea", "ax", "rb", "ec", "ed", "ae"]);
  });

  it("diffs lines", () => {
    const ops = diffLines("one\ntwo", "one\nthree");
    expect(ops.filter((o) => o.op !== "equal").map((o) => o.item)).toEqual(["three", "two"]);
  });
});

describe("stableStringify", () => {
  it("ignores key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("templateDiff", () => {
  it("reports nothing for identical templates", () => {
    const t = designed([p("Hello")]);
    expect(summarizeTemplateDiff(templateDiff(t, t))).toEqual([]);
  });

  it("finds changed, added and removed blocks", () => {
    const diff = templateDiff(
      designed([p("Title"), p("Body"), p("Old footer note")]),
      designed([p("Title (2027)"), p("Body"), p("New clause")]),
    );
    expect(diff.content.blocks).toEqual([
      { op: "changed", index: 0, type: "paragraph", before: "Title", after: "Title (2027)" },
      {
        op: "changed",
        index: 2,
        type: "paragraph",
        before: "Old footer note",
        after: "New clause",
      },
    ]);
  });

  it("finds field, section, page and theme changes", () => {
    const before = designed([]);
    const after = designed([], {
      sections: fieldSectionsSchema.parse([
        {
          title: "Parties",
          fields: [
            { type: "text", key: "principal", label: "Principal name", required: true },
            { type: "date", key: "effective", label: "Effective" },
          ],
        },
        { title: "Signing", fields: [] },
      ]),
      page: pageOptionsSchema.parse({ size: "A4" }),
      themeId: "6b0f3f7e-2f6b-4b0e-9a57-3a7c7f2b3c1d",
    });
    const diff = templateDiff(before, after);
    expect(diff.fields.added).toEqual([{ key: "effective", label: "Effective" }]);
    expect(diff.fields.removed).toEqual([{ key: "amount", label: "Amount" }]);
    expect(diff.fields.changed).toEqual([
      { key: "principal", label: "Principal name", changes: ["label", "required"] },
    ]);
    expect(diff.sections.added).toEqual(["Signing"]);
    expect(diff.page).toEqual(["Page size Letter → A4"]);
    expect(diff.theme).toEqual(["Theme added"]);
  });

  it("diffs overlay boxes by id", () => {
    const overlay = (boxes: unknown[]): DiffableTemplate => ({
      kind: "overlay",
      name: "Form",
      description: "",
      sections: [],
      sampleData: {},
      content: overlayContentSchema.parse({
        sourceId: "6b0f3f7e-2f6b-4b0e-9a57-3a7c7f2b3c1d",
        boxes,
      }),
    });
    const box = (id: string, x: number, value: string) => ({
      id,
      type: "text",
      page: 1,
      rect: { x, y: 10, width: 100, height: 12 },
      value,
    });
    const diff = templateDiff(
      overlay([box("a", 10, "{{ name }}"), box("b", 10, "x")]),
      overlay([box("a", 20, "{{ name }}"), box("c", 10, "STAMP")]),
    );
    expect(diff.boxes.added.map((b) => b.label)).toEqual(["STAMP"]);
    expect(diff.boxes.removed.map((b) => b.id)).toEqual(["b"]);
    expect(diff.boxes.changed).toEqual([
      { id: "a", page: 1, type: "text", label: "{{ name }}", changes: ["moved"] },
    ]);
    expect(summarizeTemplateDiff(diff)).toEqual(["1 box added", "1 box removed", "1 box changed"]);
  });

  it("names changed snippets", () => {
    const diff = templateDiff(
      designed([], { partials: { clause: "<p>v1</p>", same: "x" } }),
      designed([], { partials: { clause: "<p>v2</p>", same: "x" } }),
    );
    expect(diff.snippets).toEqual(["clause"]);
  });
});
