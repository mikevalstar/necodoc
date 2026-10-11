import {
  type DesignedContent,
  designedDraftSchema,
  type FieldSection,
  type PageOptions,
} from "@necodoc/shared";
import type { JSONContent } from "@tiptap/core";
import type { z } from "zod";

// The draft as the editor holds it. TipTap hands back loose JSON, so docs stay JSONContent
// until a save or preview checks them against docSchema (packages/shared/src/template-doc.ts).

export type EditorBand = { height: number; doc: JSONContent; firstPage?: JSONContent | null };
export type CodeContent = Extract<DesignedContent, { mode: "code" }>;
export type CodeBand = NonNullable<CodeContent["header"]>;
export type VisualContent = {
  mode: "visual";
  body: JSONContent;
  header: EditorBand | null;
  footer: EditorBand | null;
};
export type EditorContent = VisualContent | CodeContent;

export type DraftValues = {
  name: string;
  description: string;
  sections: FieldSection[];
  sampleData: Record<string, unknown>;
  themeId: string | null;
  page: PageOptions;
  content: EditorContent;
};

export const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** What PATCH /templates/:id takes, checked like the API checks it. */
export const draftSchema = designedDraftSchema.omit({ kind: true });
export type Draft = z.infer<typeof draftSchema>;

/** What POST /templates/:id/preview renders: the draft minus its name. */
export const previewDraftSchema = designedDraftSchema.omit({
  kind: true,
  name: true,
  description: true,
});

export function toDraftValues(template: Draft): DraftValues {
  const { name, description, sections, sampleData, themeId, page, content } = template;
  return { name, description, sections, sampleData, themeId, page, content };
}

/** A readable "where" for a draft problem's path, e.g. ["content", "header", ...] → "Header". */
export function problemArea(path: readonly PropertyKey[]) {
  const [first, second] = path;
  if (first === "sections") return "Fields";
  if (first === "page") return "Page";
  if (first === "name") return "Name";
  if (first === "content") {
    if (second === "header") return "Header";
    if (second === "footer") return "Footer";
    return "Content";
  }
  return String(first ?? "Draft");
}
