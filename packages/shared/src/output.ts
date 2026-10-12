import { z } from "zod";

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
    lang: z
      .string()
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Use a language tag such as en or fr-CA")
      .default("en")
      .meta({ description: "The document language (BCP 47), for screen readers." }),
  })
  .meta({ id: "OutputOptions", description: "PDF/A, PDF/UA and certification." });
export type OutputOptions = z.infer<typeof outputOptionsSchema>;

export const defaultOutputOptions: OutputOptions = outputOptionsSchema.parse({});

/** Whether finishing has anything to do. All-off settings stay out of compiled versions. */
export const outputEnabled = (output: OutputOptions | undefined): output is OutputOptions =>
  !!output && (output.pdfa !== null || output.pdfua || output.certify);

/** Per-request overrides on a template's own output settings. */
export const outputOverridesSchema = outputOptionsSchema.partial();
export type OutputOverrides = z.infer<typeof outputOverridesSchema>;

/** What finishing actually did, recorded on the generation. */
export const outputProfileSchema = z.object({
  pdfa: pdfaLevelSchema.nullable(),
  pdfua: z.boolean(),
  /** The certifying certificate's subject, and whether a timestamp authority countersigned. */
  certified: z.object({ subject: z.string(), timestamped: z.boolean() }).nullable(),
});
export type OutputProfile = z.infer<typeof outputProfileSchema>;
