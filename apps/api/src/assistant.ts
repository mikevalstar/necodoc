import {
  type AssistantTools,
  assistantToolDescriptions,
  assistantToolInputs,
  assistantToolOutputSchema,
  assistantToolsFor,
  type CreateTemplate,
  compileDesignedContent,
  contentTexts,
  type DesignedDraft,
  type DiffableTemplate,
  summarizeTemplateDiff,
  TemplateCompileError,
  type TemplateDiff,
  translatableStrings,
} from "@necodoc/shared";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  type LanguageModel,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIDataTypes,
  type UIMessage,
  validateUIMessages,
} from "ai";

// Spec: docs/features/ai-template-assistant.md, ADRs 0022 and 0035. The assistant's prompt and
// tools, and the summaries. The tools have no `execute`: calls stream to the editor as proposals.
// The model is a parameter so tests can pass a mock.

export type AssistantMessage = UIMessage<unknown, UIDataTypes, AssistantTools>;

/** The tool set the model sees: shared input schemas, no execute. */
const assistantTools = Object.fromEntries(
  Object.entries(assistantToolInputs).map(([name, inputSchema]) => [
    name,
    {
      description: assistantToolDescriptions[name as keyof typeof assistantToolInputs],
      inputSchema,
      outputSchema: assistantToolOutputSchema,
    },
  ]),
) satisfies ToolSet;

export type ThemeChoice = { id: string; name: string };

const GUIDE = `You are the template assistant in necodoc, a tool that fills documents (bonds, contracts, letters, forms) from a guided form and renders them to PDF.

You help the author build and edit ONE template draft, described below. Change it only by calling the tools: each call is a proposal the author reviews and applies or rejects. The tool result tells you which. Never claim a change is made before the result says "applied". The draft below is always current: it already includes every proposal of yours that was applied (so what you added earlier is there, not a duplicate), and block indexes refer to it as shown.
Make at most ONE editBody call per reply: indexes shift once it applies. To change places far apart, replace one range that spans them, or wait for the result and edit again. Explaining or answering questions needs no tool.

How templates work:
- Fields are grouped into sections; each section is one step of the guided form. Keys are snake_case and unique. A field or section can have showIf, referring only to an EARLIER field. A "group" field is a repeating list of scalar child fields (line items, co-signers).
- The visual body is TipTap JSON: an array of top-level blocks (paragraph, heading, bulletList, orderedList, blockquote, table, horizontalRule, pageBreak, image, conditionalSection, repeatingSection, rawHtml). Inline content: text (with marks bold/italic/underline/strike/link/textStyle), hardBreak, mergeField.
- A mergeField prints a declared field: attrs { field: "key", filter: null | {name:"date",format:"LL"} (LL/L are the document language's long/short date) | {name:"currency",currency:"USD"} | {name:"number",decimals:2} | {name:"upcase"} | {name:"lines"} ... }. Only use declared fields; propose new fields first (setFields) and the content after.
- conditionalSection attrs { condition } wraps blocks shown only when the condition holds (same shape as showIf). repeatingSection attrs { field: "<group key>" } repeats its blocks per item; inside it, merge fields use "group.child". A table row can repeat with attrs { repeat: "<group key>" }.
- Headers and footers are separate docs with a height in mm; only they can use the page tokens "page" and "pages" as merge fields. No pageBreak in bands.
- Code-mode templates are HTML + Liquid instead ({{ key }}, {% if %}, {% for item in group %}); edit them with setCodeBody / setCodeBand.
- Translations: the template is written in its document language. setTranslations adds one language's strings, keyed by the exact source text listed under "Translatable strings" (template name and description, field labels, help, choice labels, section titles, visual text runs). Code-mode text is only translatable when wrapped as {{ "Thank you" | t }}. Dates, numbers and currency format for the document language by themselves.
- Images need an existing asset id or an image/signature field; don't invent asset ids. No scripts and no remote URLs: renders run offline.

Style: legal and business documents. Use real headings, clear numbered clauses where apt, and tables for schedules. Keep chat replies short and plain text (the panel doesn't render Markdown; simple "- " lists are fine); put the work in tool calls. When building a whole template, propose in this order: setDetails, setFields, editBody (whole body), then bands, setSampleData with realistic values for every field. Mark the essentials required. Prefer a few complete proposals over many tiny ones.`;

function describeDraft(draft: DesignedDraft, themes: readonly ThemeChoice[]) {
  const { content } = draft;
  const json = (value: unknown) => JSON.stringify(value);
  const body =
    content.mode === "visual"
      ? content.body.content.map((block, i) => `#${i} ${json(block)}`).join("\n") || "(empty)"
      : content.body || "(empty)";
  const theme = themes.find((t) => t.id === draft.themeId);
  return `# The draft as it is now, after the proposals applied so far
Name: ${draft.name}
Description: ${draft.description || "(none)"}
Mode: ${content.mode}${content.mode === "visual" ? ` (body has ${content.body.content.length} top-level blocks)` : ""}
Page: ${json(draft.page)}
Theme: ${theme ? `${theme.name} (${theme.id})` : draft.themeId ? draft.themeId : "none"}
Themes available: ${themes.map((t) => `${t.name} (${t.id})`).join("; ") || "none"}
Signers: ${json(content.signers)}
Document language: ${content.output.lang}

## Translations (per language: source text → translation)
${json(content.translations)}

## Translatable strings
${json(translatableStrings(draft, draft.sections, contentTexts(content)))}

## Field sections
${json(draft.sections)}

## Body${content.mode === "visual" ? " (top-level blocks by index)" : " (HTML/Liquid)"}
${body}

## Header
${json(content.header)}

## Footer
${json(content.footer)}

## Template CSS
${content.css || "(none)"}

## Sample data
${json(draft.sampleData)}`;
}

/** The chat turn as a UI message stream (SSE), for useChat. */
export async function assistantResponse({
  model,
  messages,
  draft,
  themes,
  signal,
}: {
  model: LanguageModel;
  messages: unknown[];
  draft: DesignedDraft;
  themes: readonly ThemeChoice[];
  signal?: AbortSignal;
}) {
  const validated = await validateUIMessages<AssistantMessage>({
    messages,
    tools: assistantTools,
  });
  const result = streamText({
    model,
    instructions: `${GUIDE}\n\n${describeDraft(draft, themes)}`,
    messages: await convertToModelMessages(validated, { tools: assistantTools }),
    tools: assistantTools,
    activeTools: assistantToolsFor(draft.content.mode),
    // Proposals end the step; the editor's answer starts the next request.
    stopWhen: isStepCount(3),
    maxOutputTokens: 32_000,
    abortSignal: signal,
  });
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: assistantTools,
      originalMessages: validated,
      onError: (error) =>
        error instanceof Error ? error.message : "The assistant couldn't answer. Try again.",
    }),
  });
}

/** What a template is about, in text a model can read: fields and content (compiled). */
function templateText(draft: Pick<DiffableTemplate, "sections" | "content">) {
  const fields = JSON.stringify(draft.sections);
  if ("sourceId" in draft.content) {
    const boxes = draft.content.boxes.map((b) => `page ${b.page}: ${b.value}`).join("\n");
    return `An overlay on an existing PDF.\nFields: ${fields}\nBoxes stamped on the PDF:\n${boxes}`;
  }
  let html: string;
  try {
    const compiled = compileDesignedContent(draft.content, draft.sections);
    html = [compiled.header?.html, compiled.html, compiled.footer?.html]
      .filter(Boolean)
      .join("\n\n");
  } catch (error) {
    if (!(error instanceof TemplateCompileError)) throw error;
    html = JSON.stringify(draft.content);
  }
  return `Fields: ${fields}\nContent (HTML + Liquid):\n${html}`;
}

const SUMMARY_RULES =
  "Reply with the text only: no preamble, no quotes, no Markdown headings. Plain language for the people who choose and fill templates.";

/** Drafts a template description from its fields and content. */
export async function suggestDescription(model: LanguageModel, draft: CreateTemplate) {
  const res = await generateText({
    model,
    instructions: `You write the description of a document template: what the document is, who fills it in, and the key conditions (what changes the output). Two to four sentences, under 600 characters. ${SUMMARY_RULES}`,
    prompt: `Template "${draft.name}".\n${templateText(draft)}`,
    maxOutputTokens: 1000,
  });
  return res.text.trim().slice(0, 2000);
}

/**
 * Drafts a version's change note from the structural diff against the previous version, or from
 * the template itself for a first version.
 */
export async function suggestNote(
  model: LanguageModel,
  input: { name: string; diff: TemplateDiff } | { name: string; first: DiffableTemplate },
) {
  const prompt =
    "diff" in input
      ? `Template "${input.name}". Changes since the previous version, summarised:\n- ${summarizeTemplateDiff(input.diff).join("\n- ") || "(none)"}\n\nThe structural diff (blocks show text before/after):\n${JSON.stringify(input.diff)}`
      : `Template "${input.name}", first version.\n${templateText(input.first)}`;
  const res = await generateText({
    model,
    instructions: `You write the change note for a published version of a document template, for its version history. Name the actual changes (fields by label, clauses, header/footer, page or theme), most important first, as one to four short bullet lines starting with "- ". For a first version, one sentence saying what the template covers. Block texts in the diff are shortened: describe what you can see and never mention the diff, truncation or uncertainty. Under 600 characters. ${SUMMARY_RULES}`,
    prompt,
    maxOutputTokens: 1000,
  });
  return res.text.trim().slice(0, 2000);
}
