import { z } from "zod";
import { fieldSectionsSchema } from "./fields";
import { languageTagSchema } from "./locale";
import { bandSchema, pageOptionsSchema } from "./render";
import {
  createTemplateSchema,
  type DesignedContent,
  designedDraftSchema,
  visualBandSchema,
} from "./template";
import { blockNodeSchema } from "./template-doc";

// Spec: docs/features/ai-template-assistant.md, ADR 0035. The assistant's tools: their inputs
// (the API declares them to the model, which can't call them with anything else) and how an
// accepted proposal changes the draft. Browser-safe: the editor applies, the API never does.

export type DesignedDraft = z.infer<typeof designedDraftSchema>;

const summary = z
  .string()
  .min(1)
  .max(300)
  .describe("One short sentence for the author saying what this change does.");
const bandName = z.enum(["header", "footer"]);

export const assistantToolInputs = {
  setDetails: z.object({
    summary,
    name: designedDraftSchema.shape.name.optional(),
    description: z.string().max(2000).optional(),
  }),
  setFields: z.object({
    summary,
    sections: fieldSectionsSchema.describe("Every section with every field: replaces them all."),
  }),
  editBody: z.object({
    summary,
    from: z.number().int().min(0).describe("First top-level body block to replace (0-based)."),
    to: z
      .number()
      .int()
      .min(0)
      .describe("Block index to stop before. from = to inserts; blocks = [] deletes."),
    blocks: z.array(blockNodeSchema),
  }),
  setBand: z.object({
    summary,
    band: bandName,
    value: visualBandSchema.nullable().describe("null removes the band."),
  }),
  setCodeBody: z.object({ summary, html: z.string().max(2_000_000) }),
  setCodeBand: z.object({
    summary,
    band: bandName,
    value: bandSchema.nullable().describe("null removes the band."),
  }),
  setCss: z.object({ summary, css: z.string().max(200_000) }),
  setPage: z.object({
    summary,
    page: pageOptionsSchema.optional(),
    themeId: z.uuid().nullable().optional().describe("A theme id from the list, or null for none."),
  }),
  setSampleData: z.object({
    summary,
    sampleData: z
      .record(z.string(), z.unknown())
      .describe("Preview data: a value for every field, keyed like the fields."),
  }),
  setTranslations: z.object({
    summary,
    lang: languageTagSchema.describe("The language tag, e.g. fr or fr-CA."),
    strings: z
      .record(z.string().min(1).max(5000), z.string().max(20_000))
      .describe("Exact source text (from Translatable strings) to its translation."),
  }),
};

export type AssistantToolName = keyof typeof assistantToolInputs;

export const assistantToolDescriptions: Record<AssistantToolName, string> = {
  setDetails: "Propose a new template name and/or description.",
  setFields: "Propose the template's complete field sections (replaces all of them).",
  editBody:
    "Propose replacing body blocks [from, to) with new blocks (visual templates). Use from = 0, to = block count to rewrite the whole body.",
  setBand: "Propose a new header or footer, or remove one (visual templates).",
  setCodeBody: "Propose the complete HTML/Liquid body (code-mode templates).",
  setCodeBand: "Propose a new HTML/Liquid header or footer, or remove one (code-mode templates).",
  setCss: "Propose the complete template CSS, applied after the theme.",
  setPage: "Propose page size, orientation, margins and/or the theme.",
  setSampleData: "Propose the preview's sample data.",
  setTranslations:
    "Propose translations for one language, merged over that language's existing ones.",
};

const visualOnly = new Set<AssistantToolName>(["editBody", "setBand"]);
const codeOnly = new Set<AssistantToolName>(["setCodeBody", "setCodeBand"]);

/** The tools that make sense for a template in this mode. */
export function assistantToolsFor(mode: DesignedContent["mode"]): AssistantToolName[] {
  const skip = mode === "visual" ? codeOnly : visualOnly;
  return (Object.keys(assistantToolInputs) as AssistantToolName[]).filter((t) => !skip.has(t));
}

/** What the editor answers a proposal with; the model sees it as the tool result. */
export const assistantToolOutputSchema = z.object({
  status: z.enum(["applied", "rejected"]),
  /** Why it was rejected or couldn't apply. */
  note: z.string().max(1000).optional(),
});
export type AssistantToolOutput = z.infer<typeof assistantToolOutputSchema>;

/** The answer to an applied proposal. The note stops the model reading its own change as old. */
export const appliedOutput: AssistantToolOutput = {
  status: "applied",
  note: "Applied: the draft shown in your instructions now includes this change.",
};

/** The tool types useChat's messages carry (UITools in the AI SDK). */
export type AssistantTools = {
  [K in AssistantToolName]: {
    input: z.infer<(typeof assistantToolInputs)[K]>;
    output: AssistantToolOutput;
  };
};

export type AssistantCall = {
  [K in AssistantToolName]: { tool: K; input: z.infer<(typeof assistantToolInputs)[K]> };
}[AssistantToolName];

/** POST /templates/:id/assistant: the conversation and the draft as the author has it now. */
export const assistantRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(200),
  draft: designedDraftSchema,
});

/** The draft as the author has it, so an unsaved one can be summarised. */
export const suggestDescriptionSchema = z.object({ draft: createTemplateSchema });
/** No version: the saved draft against the latest version. A version: it against the one before. */
export const suggestNoteSchema = z.object({ version: z.number().int().positive().optional() });
export const suggestionSchema = z.object({ text: z.string() });

/** The parts of a draft a change touches: top-level keys, and content keys for visual bands. */
export type DraftPart =
  | "name"
  | "description"
  | "sections"
  | "sampleData"
  | "themeId"
  | "page"
  | "body"
  | "header"
  | "footer"
  | "css"
  | "translations";

export type AppliedChange =
  | { ok: true; draft: DesignedDraft; parts: DraftPart[] }
  | { ok: false; error: string };

const fail = (error: string): AppliedChange => ({ ok: false, error });

/**
 * The draft with an accepted proposal applied, checked like a save checks it. Pure: the caller
 * decides what to do with it (the editor merges just `parts`, so untouched editors keep state).
 */
export function applyAssistantCall(draft: DesignedDraft, call: AssistantCall): AppliedChange {
  const content = draft.content;
  let next: DesignedDraft;
  let parts: DraftPart[];
  switch (call.tool) {
    case "setDetails": {
      const { name, description } = call.input;
      next = {
        ...draft,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      };
      parts = [
        ...(name !== undefined ? (["name"] as const) : []),
        ...(description !== undefined ? (["description"] as const) : []),
      ];
      break;
    }
    case "setFields":
      next = { ...draft, sections: call.input.sections };
      parts = ["sections"];
      break;
    case "setSampleData":
      next = { ...draft, sampleData: call.input.sampleData };
      parts = ["sampleData"];
      break;
    case "setPage": {
      const { page, themeId } = call.input;
      next = {
        ...draft,
        ...(page ? { page } : {}),
        ...(themeId !== undefined ? { themeId } : {}),
      };
      parts = [
        ...(page ? (["page"] as const) : []),
        ...(themeId !== undefined ? (["themeId"] as const) : []),
      ];
      break;
    }
    case "setCss":
      next = { ...draft, content: { ...content, css: call.input.css } };
      parts = ["css"];
      break;
    case "setTranslations": {
      const { lang, strings } = call.input;
      if (lang.toLowerCase() === content.output.lang.toLowerCase()) {
        return fail(`${lang} is the template's own language; it needs no translations.`);
      }
      const translations = {
        ...content.translations,
        [lang]: { ...content.translations[lang], ...strings },
      };
      next = { ...draft, content: { ...content, translations } };
      parts = ["translations"];
      break;
    }
    case "editBody": {
      if (content.mode !== "visual") return fail("This template is in code mode; edit its HTML.");
      const { from, to, blocks } = call.input;
      const length = content.body.content.length;
      if (from > to || to > length) {
        return fail(`Blocks ${from}–${to} aren't in the body (it has ${length}).`);
      }
      const body = [
        ...content.body.content.slice(0, from),
        ...blocks,
        ...content.body.content.slice(to),
      ];
      // The editor needs at least one block.
      const doc = {
        type: "doc" as const,
        content: body.length ? body : [{ type: "paragraph" as const }],
      };
      next = { ...draft, content: { ...content, body: doc } };
      parts = ["body"];
      break;
    }
    case "setBand":
      if (content.mode !== "visual") return fail("This template is in code mode; edit its HTML.");
      next = { ...draft, content: { ...content, [call.input.band]: call.input.value } };
      parts = [call.input.band];
      break;
    case "setCodeBody":
      if (content.mode !== "code") return fail("This template is visual; edit its blocks.");
      next = { ...draft, content: { ...content, body: call.input.html } };
      parts = ["body"];
      break;
    case "setCodeBand":
      if (content.mode !== "code") return fail("This template is visual; edit its blocks.");
      next = { ...draft, content: { ...content, [call.input.band]: call.input.value } };
      parts = [call.input.band];
      break;
  }
  if (!parts.length) return fail("The proposal doesn't change anything.");
  const checked = designedDraftSchema.safeParse(next);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return fail(`${issue?.path.join(".") || "draft"}: ${issue?.message ?? "invalid"}`);
  }
  return { ok: true, draft: checked.data, parts };
}

/** A tool part's name and input as an AssistantCall, or null for anything else. */
export function toAssistantCall(tool: string, input: unknown): AssistantCall | null {
  if (!(tool in assistantToolInputs)) return null;
  const name = tool as AssistantToolName;
  const parsed = assistantToolInputs[name].safeParse(input);
  return parsed.success ? ({ tool: name, input: parsed.data } as AssistantCall) : null;
}
