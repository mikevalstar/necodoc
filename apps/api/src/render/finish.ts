import { type OutputOptions, type OutputProfile, outputEnabled } from "@necodoc/shared";
import { type Certifier, certifyPdf } from "./certify";
import { applyConformance } from "./conformance";

// Spec: docs/features/archival-accessible-and-certified-output.md. Runs after every render kind:
// PDF/A and PDF/UA first (ADR 0037), then certification (ADR 0038), so the signature covers the
// finished file.

export type FinishOptions = {
  output: OutputOptions | undefined;
  /** HTML renders print tagged when PDF/UA is on; overlays and packets have no structure. */
  tagged: boolean;
  title: string;
  /** Previews skip certification: they're unlogged, and the signature is invisible. */
  preview: boolean;
  certifier: () => Promise<Certifier>;
};

export async function finishPdf(pdf: Uint8Array<ArrayBuffer>, options: FinishOptions) {
  const { output, tagged, title } = options;
  const warnings: string[] = [];
  if (!outputEnabled(output)) {
    return { pdf, profile: null, warnings };
  }
  let profile: OutputProfile = { pdfa: null, pdfua: false, certified: null };
  let finished = pdf;
  const pdfua = output.pdfua && tagged;
  if (output.pdfua && !tagged) {
    warnings.push("Not PDF/UA: only HTML renders are tagged, not overlays or packets");
  }
  if (output.pdfa || pdfua) {
    const result = await applyConformance(finished, {
      pdfa: output.pdfa,
      pdfua,
      lang: output.lang,
      title,
    });
    finished = result.pdf;
    warnings.push(...result.warnings);
    profile = { ...profile, pdfa: result.pdfa, pdfua: result.pdfua };
  }
  if (output.certify && !options.preview) {
    const certifier = await options.certifier();
    const signed = await certifyPdf(finished, certifier);
    finished = signed.pdf;
    profile = {
      ...profile,
      certified: { subject: certifier.subject, timestamped: signed.timestamped },
    };
  }
  return { pdf: finished, profile, warnings };
}
