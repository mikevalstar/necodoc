import { describe, expect, it } from "vitest";
import {
  applyAssistantCall,
  assistantToolInputs,
  assistantToolsFor,
  type DesignedDraft,
  toAssistantCall,
} from "./assistant";
import { designedDraftSchema } from "./template";

const p = (text: string) => ({
  type: "paragraph" as const,
  content: [{ type: "text" as const, text }],
});

const draft = (overrides: Record<string, unknown> = {}): DesignedDraft =>
  designedDraftSchema.parse({
    kind: "designed",
    name: "Bond",
    sections: [
      { title: "Parties", fields: [{ type: "text", key: "principal", label: "Principal" }] },
    ],
    content: { mode: "visual", body: { type: "doc", content: [p("A"), p("B"), p("C")] } },
    ...overrides,
  });

const bodyText = (d: DesignedDraft) =>
  d.content.mode === "visual"
    ? d.content.body.content.map((b) =>
        b.type === "paragraph"
          ? b.content?.map((n) => (n.type === "text" ? n.text : "")).join("")
          : b.type,
      )
    : [];

describe("applyAssistantCall", () => {
  it("replaces, inserts and deletes body blocks by range", () => {
    const replace = applyAssistantCall(draft(), {
      tool: "editBody",
      input: { summary: "x", from: 1, to: 2, blocks: [p("X"), p("Y")] },
    });
    expect(replace.ok && bodyText(replace.draft)).toEqual(["A", "X", "Y", "C"]);
    expect(replace.ok && replace.parts).toEqual(["body"]);

    const insert = applyAssistantCall(draft(), {
      tool: "editBody",
      input: { summary: "x", from: 3, to: 3, blocks: [{ type: "pageBreak" }] },
    });
    expect(insert.ok && bodyText(insert.draft)).toEqual(["A", "B", "C", "pageBreak"]);

    const clear = applyAssistantCall(draft(), {
      tool: "editBody",
      input: { summary: "x", from: 0, to: 3, blocks: [] },
    });
    // The editor needs a block to put the cursor in.
    expect(clear.ok && clear.draft.content.body).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("refuses a range outside the body", () => {
    const result = applyAssistantCall(draft(), {
      tool: "editBody",
      input: { summary: "x", from: 2, to: 5, blocks: [] },
    });
    expect(result).toEqual({ ok: false, error: "Blocks 2–5 aren't in the body (it has 3)." });
  });

  it("refuses tools for the other mode", () => {
    const code = draft({ content: { mode: "code", body: "<p>Hi</p>" } });
    expect(
      applyAssistantCall(code, {
        tool: "editBody",
        input: { summary: "x", from: 0, to: 0, blocks: [] },
      }).ok,
    ).toBe(false);
    expect(
      applyAssistantCall(draft(), { tool: "setCodeBody", input: { summary: "x", html: "<p/>" } })
        .ok,
    ).toBe(false);
    const html = applyAssistantCall(code, {
      tool: "setCodeBody",
      input: { summary: "x", html: "<h1>{{ principal }}</h1>" },
    });
    expect(html.ok && html.draft.content.body).toBe("<h1>{{ principal }}</h1>");
  });

  it("sets a band and reports only that part", () => {
    const result = applyAssistantCall(draft(), {
      tool: "setBand",
      input: {
        summary: "x",
        band: "footer",
        value: { height: 12, doc: { type: "doc", content: [p("Page")] } },
      },
    });
    expect(result.ok && result.parts).toEqual(["footer"]);
    expect(
      result.ok && result.draft.content.mode === "visual" && result.draft.content.footer?.height,
    ).toBe(12);
  });

  it("only touches what the proposal sets", () => {
    const result = applyAssistantCall(draft(), {
      tool: "setPage",
      input: { summary: "x", themeId: null },
    });
    expect(result.ok && result.parts).toEqual(["themeId"]);
    expect(applyAssistantCall(draft(), { tool: "setDetails", input: { summary: "x" } })).toEqual({
      ok: false,
      error: "The proposal doesn't change anything.",
    });
  });

  it("merges translations for one language, not the template's own", () => {
    const start = draft({
      content: {
        mode: "visual",
        body: { type: "doc", content: [p("A")] },
        translations: { fr: { A: "Un" } },
      },
    });
    const result = applyAssistantCall(start, {
      tool: "setTranslations",
      input: { summary: "x", lang: "fr", strings: { Principal: "Mandant" } },
    });
    expect(result.ok && result.parts).toEqual(["translations"]);
    expect(result.ok && result.draft.content.translations).toEqual({
      fr: { A: "Un", Principal: "Mandant" },
    });
    expect(
      applyAssistantCall(start, {
        tool: "setTranslations",
        input: { summary: "x", lang: "EN", strings: { A: "A" } },
      }).ok,
    ).toBe(false);
  });

  it("replaces fields wholesale", () => {
    const result = applyAssistantCall(draft(), {
      tool: "setFields",
      input: {
        summary: "x",
        sections: [
          {
            title: "Parties",
            fields: [
              { type: "text", key: "principal", label: "Principal", required: true },
              { type: "boolean", key: "has_co_principal", label: "Co-principal?", required: false },
              {
                type: "text",
                key: "co_principal",
                label: "Co-principal",
                required: false,
                showIf: { field: "has_co_principal", op: "equals", value: true },
              },
            ],
          },
        ],
      },
    });
    expect(result.ok && result.draft.sections[0]?.fields.map((f) => f.key)).toEqual([
      "principal",
      "has_co_principal",
      "co_principal",
    ]);
  });
});

describe("tool inputs", () => {
  it("reject what the shared schemas reject", () => {
    // Show-if pointing at a later field, and an unknown block type.
    expect(
      toAssistantCall("setFields", {
        summary: "x",
        sections: [
          {
            title: "S",
            fields: [
              { type: "text", key: "a", label: "A", showIf: { field: "b", op: "is_set" } },
              { type: "text", key: "b", label: "B" },
            ],
          },
        ],
      }),
    ).toBeNull();
    expect(
      toAssistantCall("editBody", { summary: "x", from: 0, to: 0, blocks: [{ type: "script" }] }),
    ).toBeNull();
    expect(toAssistantCall("dropTable", {})).toBeNull();
    expect(toAssistantCall("setCss", { summary: "x", css: "p{}" })).toEqual({
      tool: "setCss",
      input: { summary: "x", css: "p{}" },
    });
  });

  it("offers each mode only its own content tools", () => {
    expect(assistantToolsFor("visual")).not.toContain("setCodeBody");
    expect(assistantToolsFor("code")).not.toContain("editBody");
    expect(assistantToolsFor("code")).toContain("setCodeBand");
    expect(Object.keys(assistantToolInputs)).toHaveLength(10);
  });
});
