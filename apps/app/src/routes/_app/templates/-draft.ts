import {
  createTemplateSchema,
  type DesignedContent,
  type FieldSection,
  type OverlayContent,
  type PageOptions,
  previewTemplateSchema,
  type Signer,
  type Template,
  templateSchema,
} from "@necodoc/shared";
import { queryOptions } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/core";
import type { z } from "zod";
import { api, ok } from "@/lib/api";

/** The saved draft, for editors, reviewers and publishers. */
export const templateQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id],
    // Parsed so `kind` narrows `content` (jsonb comes back untyped by kind).
    queryFn: async () =>
      templateSchema.parse(await (await ok(api.templates[":id"].$get({ param: { id } }))).json()),
  });

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
  css: string;
  signers: Signer[];
};
export type EditorContent = VisualContent | CodeContent;

/** What both kinds share; the editor's header, fields and sample data tabs change these. */
type CommonValues = {
  name: string;
  description: string;
  sections: FieldSection[];
  sampleData: Record<string, unknown>;
};
export type DesignedDraftValues = CommonValues & {
  kind: "designed";
  themeId: string | null;
  page: PageOptions;
  content: EditorContent;
};
export type OverlayDraftValues = CommonValues & { kind: "overlay"; content: OverlayContent };
export type DraftValues = DesignedDraftValues | OverlayDraftValues;
export type CommonChanges = Partial<CommonValues>;

export const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** The draft checked like the API checks it; PATCH /templates/:id ignores the `kind`. */
export const draftSchema = createTemplateSchema;

/** What POST /templates/:id/preview renders: the draft minus its name. */
export const previewDraftSchema = previewTemplateSchema.shape.draft.unwrap();
export type PreviewDraft = z.infer<typeof previewDraftSchema>;

export function toDraftValues(template: Template): DraftValues {
  const { name, description, sections, sampleData } = template;
  const common = { name, description, sections, sampleData };
  return template.kind === "overlay"
    ? { kind: "overlay", ...common, content: template.content }
    : {
        kind: "designed",
        ...common,
        themeId: template.themeId,
        page: template.page,
        content: template.content,
      };
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
    if (second === "boxes") return "Boxes";
    if (second === "signers") return "Signing";
    return "Content";
  }
  return String(first ?? "Draft");
}
