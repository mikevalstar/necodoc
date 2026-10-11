import { z } from "zod";
import { compileDoc } from "./compile";
import { fieldKeySchema } from "./fields";
import { docSchema } from "./template-doc";

// Spec: docs/features/snippet-library.md. A snippet is a Liquid partial: templates include it with
// `{% render 'key' %}` (code) or a snippet block (visual, by id).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set once at creation: code-mode templates and API HTML name the snippet by it. */
export const snippetKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, digits, - and _")
  .max(64)
  // Visual blocks render snippets by id, so a key must never read as one.
  .refine((key) => !UUID.test(key), { message: "A key can't look like an id" });

/** Like a template's content: TipTap JSON in the visual editor, or HTML/Liquid in code mode. */
export const snippetContentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("visual"), doc: docSchema }),
  z.object({ mode: z.literal("code"), html: z.string().max(200_000) }),
]);
export type SnippetContent = z.infer<typeof snippetContentSchema>;

const tagSchema = z.string().trim().min(1).max(50);

export const createSnippetSchema = z.object({
  key: snippetKeySchema,
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: z.string().max(2000).default(""),
  tags: z.array(tagSchema).max(20).default([]),
  /** Top-level field keys the snippet uses; templates that lack one get it flagged. */
  fields: z.array(fieldKeySchema).max(100).default([]),
  content: snippetContentSchema.default({
    mode: "visual",
    doc: { type: "doc", content: [{ type: "paragraph" }] },
  }),
});
export type CreateSnippetInput = z.input<typeof createSnippetSchema>;

/** The key can't change; `archived` hides the snippet from pickers. */
export const updateSnippetSchema = createSnippetSchema
  .omit({ key: true })
  .extend({
    description: createSnippetSchema.shape.description.unwrap(),
    tags: createSnippetSchema.shape.tags.unwrap(),
    fields: createSnippetSchema.shape.fields.unwrap(),
    content: snippetContentSchema,
    archived: z.boolean(),
  })
  .partial();
export type UpdateSnippet = z.infer<typeof updateSnippetSchema>;

export const snippetSchema = createSnippetSchema.extend({
  id: z.uuid(),
  createdBy: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Snippet = z.infer<typeof snippetSchema>;

/** A template that uses a snippet, in its draft or its latest published version. */
export const snippetUsageSchema = z.object({
  templateId: z.uuid(),
  name: z.string(),
  latestVersion: z.number().int().nullable(),
  inDraft: z.boolean(),
  /** The latest version was published with a copy of this snippet. */
  inLatestVersion: z.boolean(),
  /** That copy differs from the snippet now: republish to pick up the edit. */
  outOfDate: z.boolean(),
});
export type SnippetUsage = z.infer<typeof snippetUsageSchema>;

/** The HTML/Liquid a snippet renders as. Throws TemplateCompileError like compileDoc. */
export const compileSnippet = (content: SnippetContent) =>
  content.mode === "code" ? content.html : compileDoc(content.doc);
