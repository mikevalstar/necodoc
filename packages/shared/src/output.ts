import { z } from "zod";
import { languageTagSchema } from "./locale";

// Spec: docs/features/archival-accessible-and-certified-output.md.
// ADR 0037 (PDF/A and PDF/UA by post-processing), ADR 0038 (PAdES certification).

/** PDF/A-2 conformance levels: `b` is visual fidelity, `u` adds Unicode text for every glyph. */
export const pdfaLevelSchema = z.enum(["2b", "2u"]);
export type PdfaLevel = z.infer<typeof pdfaLevelSchema>;

/** How a PDF is finished after rendering: archival, accessible, certified. All off by default. */
export const outputOptionsSchema = z
  .object({
    pdfa: pdfaLevelSchema
      .nullable()
      .default(null)
      .meta({ description: "PDF/A-2 level (`2b` or `2u`), or null for none." }),
    pdfua: z.boolean().default(false).meta({
      description:
        "Tagged PDF/UA-1. HTML renders only: overlays and packets have no structure to tag.",
    }),
    certify: z.boolean().default(false).meta({
      description:
        "Certify with the server's certificate (PAdES, DocMDP: form filling and signing stay allowed).",
    }),
    lang: languageTagSchema.default("en").meta({
      description:
        "The document language (BCP 47): date, number and currency formatting, translations, text direction, and the PDF language.",
    }),
  })
  .meta({
    id: "OutputOptions",
    description: "PDF/A, PDF/UA, certification and the document language.",
  });
export type OutputOptions = z.infer<typeof outputOptionsSchema>;

export const defaultOutputOptions: OutputOptions = outputOptionsSchema.parse({});

/** Whether finishing has anything to do. All-off settings stay out of compiled versions. */
/** Whether a compiled version keeps the settings: finishing is on, or the language isn't `en`. */
export const outputWorthKeeping = (output: OutputOptions) =>
  output.lang !== defaultOutputOptions.lang || outputEnabled(output);

export const outputEnabled = (output: OutputOptions | undefined): output is OutputOptions =>
  !!output && (output.pdfa !== null || output.pdfua || output.certify);

/** An option without its default: an override left out keeps the template's setting. */
const override = <T extends z.ZodType>(option: z.ZodDefault<T>) =>
  option
    .unwrap()
    .optional()
    .meta(option.meta() ?? {});

/**
 * Per-request overrides on a template's own output settings. Not `.partial()`: that keeps the
 * defaults, so `{ certify: false }` would also turn PDF/A and the language back off.
 */
const { pdfa, pdfua, certify, lang } = outputOptionsSchema.shape;
export const outputOverridesSchema = z.object({
  pdfa: override(pdfa),
  pdfua: override(pdfua),
  certify: override(certify),
  lang: override(lang),
});
export type OutputOverrides = z.infer<typeof outputOverridesSchema>;

/** What finishing actually did, recorded on the generation. */
export const outputProfileSchema = z.object({
  pdfa: pdfaLevelSchema.nullable(),
  pdfua: z.boolean(),
  /** The certifying certificate's subject, and whether a timestamp authority countersigned. */
  certified: z.object({ subject: z.string(), timestamped: z.boolean() }).nullable(),
});
export type OutputProfile = z.infer<typeof outputProfileSchema>;
