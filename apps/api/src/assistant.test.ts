import { designedDraftSchema } from "@necodoc/shared";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { assistantResponse, suggestDescription } from "./assistant";

// The assistant route's model side with a mock model: proposals stream out as tool calls the
// editor answers, and a call that doesn't fit the shared schemas never reaches the editor.

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function toolCallModel(toolName: string, input: unknown) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ],
        }),
      };
    },
  });
  return { model, prompts };
}

const draft = designedDraftSchema.parse({ kind: "designed", name: "Bond" });
const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Add a footer" }] }];

/** The UI message stream's JSON chunks. */
async function chunks(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as { type: string; [key: string]: unknown });
}

describe("assistantResponse", () => {
  it("streams a valid proposal to the editor without executing it", async () => {
    const value = { height: 12, doc: { type: "doc", content: [{ type: "paragraph" }] } };
    const { model, prompts } = toolCallModel("setBand", {
      summary: "Footer",
      band: "footer",
      value,
    });
    const res = await assistantResponse({ model, messages, draft, themes: [] });
    const parts = await chunks(res);
    const call = parts.find((p) => p.type === "tool-input-available");
    expect(call).toMatchObject({ toolName: "setBand", input: { band: "footer", value } });
    // No result: the editor answers it.
    expect(parts.some((p) => p.type === "tool-output-available")).toBe(false);
    expect(prompts).toHaveLength(1);
  });

  it("offers only the current mode's content tools and describes the draft", async () => {
    const { model, prompts } = toolCallModel("setCss", { summary: "x", css: "" });
    await (await assistantResponse({ model, messages, draft, themes: [] })).text();
    const options = prompts[0] as {
      tools: { name: string }[];
      prompt: { role: string; content: unknown }[];
    };
    const names = options.tools.map((t) => t.name);
    expect(names).toContain("editBody");
    expect(names).not.toContain("setCodeBody");
    expect(JSON.stringify(options.prompt[0])).toContain("Name: Bond");
  });

  it("turns a call that breaks the shared schemas into an error, not a proposal", async () => {
    const { model } = toolCallModel("editBody", {
      summary: "x",
      from: 0,
      to: 0,
      blocks: [{ type: "script", attrs: { src: "x" } }],
    });
    const parts = await chunks(await assistantResponse({ model, messages, draft, themes: [] }));
    expect(parts.some((p) => p.type === "tool-input-available")).toBe(false);
    expect(parts.some((p) => p.type === "tool-input-error" || p.type === "tool-output-error")).toBe(
      true,
    );
  });
});

describe("suggestDescription", () => {
  it("returns the model's text, trimmed", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "  A bond for contractors.\n" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    });
    expect(await suggestDescription(model, draft)).toBe("A bond for contractors.");
  });
});
