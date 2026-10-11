import { z } from "zod";
import { conditionSchema, fieldKeySchema, fieldPathSchema } from "./fields";

// The TipTap JSON the template editor stores (ADR 0016). Node and mark names are TipTap's own
// (StarterKit, Table, Image, TextAlign, TextStyle + Color, Link) plus necodoc's custom nodes:
// mergeField, conditionalSection, repeatingSection, pageBreak, rawHtml and snippet. Anything else is rejected, so
// the editor and the compiler (compile.ts) can't drift apart silently. Unknown attrs are dropped.

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");
const href = z
  .string()
  .max(2000)
  .regex(/^(https?:|mailto:|tel:|#)/i, "Links must be http(s), mailto, tel or #anchor");

export const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("link"), attrs: z.object({ href }) }),
  z.object({ type: z.literal("textStyle"), attrs: z.object({ color: colour.nullish() }) }),
]);
export type Mark = z.infer<typeof markSchema>;

/** Liquid filters a merge field can apply. Arguments are data, never raw Liquid. */
export const mergeFilterSchema = z.discriminatedUnion("name", [
  /** dayjs format tokens, e.g. "MMM D, YYYY". */
  z.object({ name: z.literal("date"), format: z.string().min(1).max(50) }),
  z.object({ name: z.literal("number"), decimals: z.number().int().min(0).max(10) }),
  z.object({ name: z.literal("currency"), currency: z.string().regex(/^[A-Z]{3}$/) }),
  z.object({ name: z.literal("upcase") }),
  z.object({ name: z.literal("downcase") }),
  z.object({ name: z.literal("capitalize") }),
  /** Keeps a long text's line breaks. */
  z.object({ name: z.literal("lines") }),
]);
export type MergeFilter = z.infer<typeof mergeFilterSchema>;

const marks = z.array(markSchema).optional();

export const textNodeSchema = z.object({ type: z.literal("text"), text: z.string(), marks });
export const hardBreakNodeSchema = z.object({ type: z.literal("hardBreak"), marks });
/**
 * Inline atom. `field` is a key, `group.key` inside a repeating section over `group`, or the
 * band page tokens `page` / `pages`.
 */
export const mergeFieldNodeSchema = z.object({
  type: z.literal("mergeField"),
  attrs: z.object({ field: fieldPathSchema, filter: mergeFilterSchema.nullish() }),
  marks,
});

export const inlineNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  hardBreakNodeSchema,
  mergeFieldNodeSchema,
]);
export type InlineNode = z.infer<typeof inlineNodeSchema>;

const textAlign = z.enum(["left", "center", "right", "justify"]).nullish();
const inline = z.array(inlineNodeSchema).optional();

export const paragraphNodeSchema = z.object({
  type: z.literal("paragraph"),
  attrs: z.object({ textAlign }).optional(),
  content: inline,
});
export const headingNodeSchema = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.number().int().min(1).max(6), textAlign }),
  content: inline,
});
export const horizontalRuleNodeSchema = z.object({ type: z.literal("horizontalRule") });
/** Starts a new page. */
export const pageBreakNodeSchema = z.object({ type: z.literal("pageBreak") });

/**
 * Advanced markup inside a visual template: HTML + Liquid output verbatim, not escaped. Renders
 * run without JavaScript or network (ADR 0012), and publish checks the Liquid parses.
 */
export const rawHtmlNodeSchema = z.object({
  type: z.literal("rawHtml"),
  attrs: z.object({ html: z.string().max(200_000) }),
});

/**
 * A snippet from the library (docs/features/snippet-library.md), by id so renaming it doesn't
 * break the reference. Compiles to `{% render '<id>' %}`.
 */
export const snippetNodeSchema = z.object({
  type: z.literal("snippet"),
  attrs: z.object({ snippetId: z.uuid() }),
});

/** Block image: an uploaded asset, or the value of an image/signature field. Exactly one. */
export const imageNodeSchema = z.object({
  type: z.literal("image"),
  attrs: z
    .object({
      assetId: z.uuid().nullish(),
      field: fieldPathSchema.nullish(),
      alt: z.string().max(500).nullish(),
      /** Percent of the content width; natural size when unset. */
      width: z.number().min(1).max(100).nullish(),
    })
    .refine((a) => !a.assetId !== !a.field, { message: "Set either assetId or field" }),
});

// Recursive nodes. Getters let the schemas refer to blockNodeSchema before it exists.

export const listItemNodeSchema = z.object({
  type: z.literal("listItem"),
  get content(): z.ZodArray<typeof blockNodeSchema> {
    return z.array(blockNodeSchema);
  },
});
export const bulletListNodeSchema = z.object({
  type: z.literal("bulletList"),
  content: z.array(listItemNodeSchema),
});
export const orderedListNodeSchema = z.object({
  type: z.literal("orderedList"),
  attrs: z.object({ start: z.number().int().min(0).nullish() }).optional(),
  content: z.array(listItemNodeSchema),
});
export const blockquoteNodeSchema = z.object({
  type: z.literal("blockquote"),
  get content(): z.ZodArray<typeof blockNodeSchema> {
    return z.array(blockNodeSchema);
  },
});

const cellAttrs = z
  .object({
    colspan: z.number().int().min(1).nullish(),
    rowspan: z.number().int().min(1).nullish(),
  })
  .optional();
export const tableCellNodeSchema = z.object({
  type: z.enum(["tableCell", "tableHeader"]),
  attrs: cellAttrs,
  get content(): z.ZodArray<typeof blockNodeSchema> {
    return z.array(blockNodeSchema);
  },
});
/** `repeat` names a repeating group: the row is emitted once per item (line-item tables). */
export const tableRowNodeSchema = z.object({
  type: z.literal("tableRow"),
  attrs: z.object({ repeat: fieldKeySchema.nullish() }).optional(),
  content: z.array(tableCellNodeSchema),
});
/** Leading rows made only of tableHeader cells become <thead> and repeat on every page. */
export const tableNodeSchema = z.object({
  type: z.literal("table"),
  content: z.array(tableRowNodeSchema),
});

/** Block wrapper shown only while `condition` holds. */
export const conditionalSectionNodeSchema = z.object({
  type: z.literal("conditionalSection"),
  attrs: z.object({ condition: conditionSchema }),
  get content(): z.ZodArray<typeof blockNodeSchema> {
    return z.array(blockNodeSchema);
  },
});
/** Block wrapper repeated per item of the repeating group `field`. Doesn't nest. */
export const repeatingSectionNodeSchema = z.object({
  type: z.literal("repeatingSection"),
  attrs: z.object({ field: fieldKeySchema }),
  get content(): z.ZodArray<typeof blockNodeSchema> {
    return z.array(blockNodeSchema);
  },
});

type BlockNodeSchema = z.ZodDiscriminatedUnion<
  [
    typeof paragraphNodeSchema,
    typeof headingNodeSchema,
    typeof bulletListNodeSchema,
    typeof orderedListNodeSchema,
    typeof blockquoteNodeSchema,
    typeof horizontalRuleNodeSchema,
    typeof pageBreakNodeSchema,
    typeof imageNodeSchema,
    typeof tableNodeSchema,
    typeof conditionalSectionNodeSchema,
    typeof repeatingSectionNodeSchema,
    typeof rawHtmlNodeSchema,
    typeof snippetNodeSchema,
  ]
>;

export const blockNodeSchema: BlockNodeSchema = z.discriminatedUnion("type", [
  paragraphNodeSchema,
  headingNodeSchema,
  bulletListNodeSchema,
  orderedListNodeSchema,
  blockquoteNodeSchema,
  horizontalRuleNodeSchema,
  pageBreakNodeSchema,
  imageNodeSchema,
  tableNodeSchema,
  conditionalSectionNodeSchema,
  repeatingSectionNodeSchema,
  rawHtmlNodeSchema,
  snippetNodeSchema,
]);
export type BlockNode = z.infer<typeof blockNodeSchema>;
export type TableRowNode = z.infer<typeof tableRowNodeSchema>;

export const docSchema = z.object({
  type: z.literal("doc"),
  content: z.array(blockNodeSchema).default([]),
});
export type Doc = z.infer<typeof docSchema>;
