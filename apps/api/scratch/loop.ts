import { readFileSync, writeFileSync } from "node:fs";
import {
  appliedOutput,
  applyAssistantCall,
  compileDesignedContent,
  type DesignedDraft,
  designedDraftSchema,
  templateFieldProblems,
  toAssistantCall,
} from "@necodoc/shared";
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from "ai";
import { aiModel } from "../src/ai";
import { assistantResponse } from "../src/assistant";

if (!aiModel) throw new Error("no ai");
const [prompt, inFile, outFile] = process.argv.slice(2);
let draft: DesignedDraft = inFile
  ? designedDraftSchema.parse(JSON.parse(readFileSync(inFile, "utf8")))
  : designedDraftSchema.parse({ kind: "designed", name: "Untitled template" });
const messages: any[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: prompt }] }];
const usage = 0;
for (let round = 0; round < 8; round++) {
  const t0 = Date.now();
  const res = await assistantResponse({
    model: aiModel,
    messages,
    draft,
    themes: [{ id: "00000000-0000-4000-8000-000000000001", name: "Plain" }],
  });
  const chunks = parseJsonEventStream({
    stream: res.body!,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream({
      transform(c: any, ctl) {
        if (c.success) ctl.enqueue(c.value);
        else console.log("PARSE FAIL", c.error?.message?.slice(0, 200));
      },
    }),
  );
  let last: any;
  for await (const m of readUIMessageStream({ stream: chunks as any })) last = m;
  messages.push(last);
  let pending = 0;
  for (const part of last.parts) {
    if (part.type === "text") console.log(`[r${round}] TEXT:`, part.text.slice(0, 500));
    if (part.type?.startsWith("tool-")) {
      const tool = part.type.slice(5);
      if (part.state === "output-error") {
        console.log(`[r${round}] TOOL ERROR`, tool, part.errorText?.slice(0, 300));
        continue;
      }
      if (part.state !== "input-available") continue;
      const call = toAssistantCall(tool, part.input);
      const applied = call
        ? applyAssistantCall(draft, call)
        : { ok: false as const, error: "bad input" };
      console.log(
        `[r${round}] ${tool}: ${part.input.summary} -> ${applied.ok ? "applied " + applied.parts.join(",") : applied.error}`,
      );
      if (applied.ok) draft = applied.draft;
      part.state = "output-available";
      part.output = applied.ok ? appliedOutput : { status: "rejected", note: applied.error };
      pending++;
    }
  }
  console.log(`[r${round}] ${Date.now() - t0}ms`);
  if (!pending) break;
}
writeFileSync(outFile ?? "scratch/draft.json", JSON.stringify(draft, null, 2));
const compiled = compileDesignedContent(draft.content, draft.sections);
console.log(
  "fields:",
  draft.sections
    .flatMap((s) => s.fields.map((f) => f.key + (f.showIf ? `(if ${f.showIf.field})` : "")))
    .join(", "),
);
console.log("problems:", JSON.stringify(templateFieldProblems(draft.content, draft.sections)));
console.log(
  "html length",
  compiled.html.length,
  "header",
  !!compiled.header,
  "footer",
  !!compiled.footer,
);
