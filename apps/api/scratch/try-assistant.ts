import { designedDraftSchema } from "@necodoc/shared";
import { aiModel } from "../src/ai";
import { assistantResponse } from "../src/assistant";

const draft = designedDraftSchema.parse({ kind: "designed", name: "Untitled template" });
const messages = [
  {
    id: "u1",
    role: "user",
    parts: [
      {
        type: "text",
        text:
          process.argv[2] ??
          "Create this template from scratch: a surety bond for a contractor licence in Oregon, principal, surety and obligee, penal sum, effective date.",
      },
    ],
  },
];
if (!aiModel) throw new Error("no ai");
const t0 = Date.now();
const res = await assistantResponse({
  model: aiModel,
  messages,
  draft,
  themes: [{ id: "00000000-0000-4000-8000-000000000001", name: "Plain" }],
});
const text = await res.text();
const out: string[] = [];
for (const line of text.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const data = line.slice(6);
  if (data === "[DONE]") continue;
  const chunk = JSON.parse(data);
  if (
    [
      "tool-input-available",
      "tool-input-error",
      "error",
      "finish",
      "text-delta",
      "tool-output-error",
    ].includes(chunk.type)
  )
    out.push(chunk);
}
const texts = out
  .filter((c: any) => c.type === "text-delta")
  .map((c: any) => c.delta)
  .join("");
console.log("TEXT:", texts);
for (const c of out as any[])
  if (c.type !== "text-delta")
    console.log(
      c.type,
      c.toolName ?? "",
      c.type === "tool-input-available"
        ? JSON.stringify(c.input).slice(0, 400)
        : JSON.stringify(c).slice(0, 600),
    );
console.log("ms", Date.now() - t0);
