import { z } from "zod";
import { outputOptionsSchema } from "./output";
import type { FieldProblem } from "./compile";
import { type FieldSection, fieldKeySchema, RESERVED_FIELD_KEYS } from "./fields";
import { signersSchema, signingKindSchema, signingRenderOptionsSchema } from "./signing";
import { themeFontSchema } from "./theme";

// Spec: docs/features/pdf-overlay-templates.md. An overlay template is an uploaded PDF (a PDF
// source) plus boxes placed on its pages. ADRs 0013, 0027, 0028.

/** Uploads past this many pages are refused. */
export const MAX_OVERLAY_PAGES = 200;
/** AI detection looks at the first N pages only (ADR 0028). */
export const MAX_DETECT_PAGES = 20;

/** PDF points in the page's own user space (MediaBox coordinates, origin bottom-left). */
export const overlayRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type OverlayRect = z.infer<typeof overlayRectSchema>;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");

export const textStyleSchema = z.object({
  /** A bundled font or an uploaded TTF/OTF asset. */
  font: themeFontSchema.default("noto-sans"),
  /** Points. */
  size: z.number().min(4).max(96).default(10),
  /** Shrinks the size down to `minSize` until the value fits. */
  autoShrink: z.boolean().default(true),
  minSize: z.number().min(2).max(96).default(6),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("middle"),
  color: colorSchema.default("#000000"),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const barcodeSymbologies = [
  "code128",
  "code39",
  "ean13",
  "upca",
  "pdf417",
  "datamatrix",
] as const;

const boxBase = {
  id: z.string().min(1).max(64),
  /** 1-based. */
  page: z.int().min(1),
  rect: overlayRectSchema,
  /** Liquid over the template's fields, rendered without HTML escaping. */
  value: z.string().max(10_000).default(""),
  /** Fill this AcroForm field (fully qualified name) instead of drawing. */
  acroField: z.string().min(1).max(500).optional(),
};

export const overlayBoxSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["text", "multiline", "number", "date"]),
    ...boxBase,
    style: textStyleSchema.prefault({}),
  }),
  z.object({
    type: z.literal("checkbox"),
    ...boxBase,
    mark: z.enum(["check", "cross", "fill"]).default("check"),
    color: colorSchema.default("#000000"),
  }),
  /** Value: a `data:` URL (PNG, JPEG or WebP) or `{{ asset_id | asset_url }}`. */
  z.object({ type: z.literal("image"), ...boxBase }),
  /**
   * With a signer, a box in the signing package (docs/features/signing-packages.md) that draws
   * nothing; without one, it draws the signature image in its value.
   */
  z.object({
    type: z.literal("signature"),
    ...boxBase,
    signerId: fieldKeySchema.optional(),
    signingKind: signingKindSchema.optional(),
    /** Only with a signer: false makes the provider's field optional. */
    required: z.boolean().optional(),
  }),
  z.object({ type: z.literal("qrcode"), ...boxBase }),
  z.object({
    type: z.literal("barcode"),
    ...boxBase,
    symbology: z.enum(barcodeSymbologies).default("code128"),
  }),
]);
export type OverlayBox = z.infer<typeof overlayBoxSchema>;
export type OverlayBoxInput = z.input<typeof overlayBoxSchema>;
export type OverlayBoxType = OverlayBox["type"];
export const overlayBoxTypes = [
  "text",
  "multiline",
  "number",
  "date",
  "checkbox",
  "image",
  "signature",
  "qrcode",
  "barcode",
] as const satisfies readonly OverlayBoxType[];

/** Unique within a template; boxes come from the editor, imports and AI suggestions. */
export const newBoxId = () => `b${Math.random().toString(36).slice(2, 10)}`;

const boxesSchema = z
  .array(overlayBoxSchema)
  .max(2000)
  .superRefine((boxes, ctx) => {
    const seen = new Set<string>();
    boxes.forEach((box, i) => {
      if (seen.has(box.id))
        ctx.addIssue({ code: "custom", message: "Duplicate box id", path: [i, "id"] });
      seen.add(box.id);
    });
  });

export const overlayContentSchema = z.object({
  /** The uploaded PDF (GET /api/pdf-sources/:id). */
  sourceId: z.uuid(),
  boxes: boxesSchema.default([]),
  /** Output has no editable form fields. */
  flatten: z.boolean().default(false),
  /** Who signs the boxes that name a signer (docs/features/signing-packages.md). */
  signers: signersSchema.default([]),
  /** PDF/A and certification; in content so versions freeze them. */
  output: outputOptionsSchema.default(outputOptionsSchema.parse({})),
});
export type OverlayContent = z.infer<typeof overlayContentSchema>;

// ---------------------------------------------------------------------------------------------
// PDF sources: what the API read from an upload (ADR 0028)

export const pageRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const pdfPageSchema = z.object({
  /** The visible area (crop box) in user space: [x1, y1, x2, y2]. */
  view: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  rotate: pageRotationSchema,
});
export type PdfPage = z.infer<typeof pdfPageSchema>;

export const acroFieldTypeSchema = z.enum([
  "text",
  "checkbox",
  "radio",
  "choice",
  "signature",
  "button",
]);

/** One AcroForm field, at its first widget. */
export const acroFieldSchema = z.object({
  name: z.string(),
  type: acroFieldTypeSchema,
  page: z.int().min(1),
  rect: overlayRectSchema,
  /** The tooltip (/TU), often the form's own words for it. */
  label: z.string().optional(),
  multiline: z.boolean(),
  maxLength: z.int().optional(),
  /** Radio export values, or choice options. */
  options: z.array(z.string()),
  readOnly: z.boolean(),
});
export type AcroField = z.infer<typeof acroFieldSchema>;

export const pdfSourceSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  size: z.int(),
  pages: z.array(pdfPageSchema),
  fields: z.array(acroFieldSchema),
  /** Encrypted with an empty password; outputs are saved unencrypted (ADR 0027). */
  encrypted: z.boolean(),
  /** Hybrid XFA + AcroForm; the XFA part is dropped from outputs. */
  xfa: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PdfSource = z.infer<typeof pdfSourceSchema>;

// ---------------------------------------------------------------------------------------------
// Rendering

/** What a generation of an overlay template stores and a worker renders. */
export const overlayRenderRequestSchema = z.object({
  kind: z.literal("overlay"),
  sourceId: z.uuid(),
  boxes: z.array(overlayBoxSchema),
  flatten: z.boolean(),
  signers: signersSchema.optional(),
  signing: signingRenderOptionsSchema.optional(),
  output: outputOptionsSchema.optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  filename: z.string().trim().min(1).max(200).optional(),
  preview: z.boolean().default(false),
});
export type OverlayRenderRequest = z.infer<typeof overlayRenderRequestSchema>;

/** A published overlay version's render input, minus the data. */
export type CompiledOverlay = Pick<
  OverlayRenderRequest,
  "kind" | "sourceId" | "boxes" | "flatten" | "signers" | "output"
>;

// ---------------------------------------------------------------------------------------------
// AI detection (ADR 0028)

export const detectableBoxTypes = [
  "text",
  "multiline",
  "number",
  "date",
  "checkbox",
  "signature",
  "image",
] as const satisfies readonly OverlayBoxType[];
export type DetectableBoxType = (typeof detectableBoxTypes)[number];

/** A suggestion: unsaved until the editor accepts it. */
export const detectedFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(detectableBoxTypes),
  page: z.int().min(1),
  rect: overlayRectSchema,
  /** Snapped to a printed line, cell or square; false means the model's estimate. */
  anchored: z.boolean(),
});
export type DetectedField = z.infer<typeof detectedFieldSchema>;

/** POST /pdf-sources/:id/detect: the template's fields, so suggestions reuse their keys. */
export const detectRequestSchema = z.object({
  fields: z
    .array(z.object({ key: z.string().max(64), label: z.string().max(200) }))
    .max(500)
    .default([]),
});

export const detectionResultSchema = z.object({
  fields: z.array(detectedFieldSchema),
  /** Pages sent to the model; pages with no lines or squares are skipped. */
  pagesSent: z.int(),
  pagesSkipped: z.int(),
  /** Pages past MAX_DETECT_PAGES. */
  pagesNotChecked: z.int(),
  inputTokens: z.int(),
  outputTokens: z.int(),
  ms: z.int(),
});
export type DetectionResult = z.infer<typeof detectionResultSchema>;

/** GET /pdf-sources/:id/detect/:jobId */
export const detectionStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("done"), result: detectionResultSchema }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);
export type DetectionStatus = z.infer<typeof detectionStatusSchema>;

// ---------------------------------------------------------------------------------------------
// Checks

const VARIABLE =
  /\{\{-?\s*([a-z_][a-z0-9_]*)|\{%-?\s*(?:if|unless|elsif|case)\s+([a-z_][a-z0-9_]*)/g;
const LIQUID_NAMES = new Set([
  "true",
  "false",
  "nil",
  "null",
  "empty",
  "blank",
  ...RESERVED_FIELD_KEYS,
]);

/** Top-level names a Liquid expression reads, roughly: `{{ name` and `{% if name`. */
export function liquidVariables(source: string): string[] {
  return [...source.matchAll(VARIABLE)].flatMap((m) => {
    const name = m[1] ?? m[2];
    return name && !LIQUID_NAMES.has(name) ? [name] : [];
  });
}

/**
 * Boxes whose value reads a field the template doesn't declare, or that name a signer it doesn't
 * have. Rendering doesn't block on either.
 */
export function overlayFieldProblems(
  content: Pick<OverlayContent, "boxes" | "signers">,
  sections: readonly FieldSection[],
): FieldProblem[] {
  const keys = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  const signers = new Set(content.signers.map((s) => s.id));
  return content.boxes.flatMap((box) => [
    ...[...new Set(liquidVariables(box.value))]
      .filter((name) => !keys.has(name))
      .map((name) => ({
        field: name,
        message: `A box on page ${box.page} uses "${name}", which isn't a declared field`,
      })),
    ...(box.type === "signature" && box.signerId && !signers.has(box.signerId)
      ? [
          {
            field: box.signerId,
            message: `A box on page ${box.page} is for "${box.signerId}", which isn't a signer`,
          },
        ]
      : []),
  ]);
}
