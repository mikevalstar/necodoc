import {
  type OutputOptions,
  outputOptionsSchema,
  type PdfaLevel,
  pdfaLevelSchema,
} from "@necodoc/shared";
import { useState } from "react";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";

// Spec: docs/features/archival-accessible-and-certified-output.md. How this template's PDFs are
// finished: PDF/A, PDF/UA (designed only), certification. API calls can override each one.

const pdfaLabels: Record<PdfaLevel, string> = {
  "2b": "PDF/A-2b (looks the same in the future)",
  "2u": "PDF/A-2u (also keeps all text searchable)",
};

export function OutputPanel({
  output,
  kind,
  editable,
  onChange,
}: {
  output: OutputOptions;
  kind: "designed" | "overlay";
  editable: boolean;
  onChange: (output: OutputOptions) => void;
}) {
  // The language is checked on save; keep what's typed until it's a valid tag.
  const [lang, setLang] = useState(output.lang);
  const validLang = (value: string) => outputOptionsSchema.shape.lang.safeParse(value).success;
  return (
    <fieldset disabled={!editable}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="output-pdfa">Archival (PDF/A)</FieldLabel>
          <NativeSelect
            id="output-pdfa"
            value={output.pdfa ?? ""}
            onChange={(e) => {
              const level = pdfaLevelSchema.safeParse(e.target.value);
              onChange({ ...output, pdfa: level.success ? level.data : null });
            }}
          >
            <NativeSelectOption value="">Off</NativeSelectOption>
            {pdfaLevelSchema.options.map((level) => (
              <NativeSelectOption key={level} value={level}>
                {pdfaLabels[level]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            {kind === "overlay"
              ? "Only works when the uploaded PDF embeds its fonts and has no scripts or attachments; otherwise the PDF is made without the PDF/A claim and the generation says why."
              : "For records that must stay readable for years. Adds the metadata and colour profile archives check for."}
          </FieldDescription>
        </Field>
        {kind === "designed" && (
          <Field orientation="horizontal">
            <Switch
              id="output-pdfua"
              checked={output.pdfua}
              onCheckedChange={(pdfua) => onChange({ ...output, pdfua })}
            />
            <FieldLabel htmlFor="output-pdfua">
              Accessible (tagged PDF/UA): headings, tables, links and images are tagged for screen
              readers
            </FieldLabel>
          </Field>
        )}
        {kind === "designed" && output.pdfua && (
          <Field>
            <FieldLabel htmlFor="output-lang">Document language</FieldLabel>
            <Input
              id="output-lang"
              className="w-32 font-mono"
              value={lang}
              aria-invalid={!validLang(lang)}
              onChange={(e) => {
                setLang(e.target.value);
                if (validLang(e.target.value)) {
                  onChange({ ...output, lang: e.target.value });
                }
              }}
            />
            <FieldDescription>
              A language tag such as en or fr-CA. Give every image alt text, or the PDF won&apos;t
              pass an accessibility check.
            </FieldDescription>
          </Field>
        )}
        <Field orientation="horizontal">
          <Switch
            id="output-certify"
            checked={output.certify}
            onCheckedChange={(certify) => onChange({ ...output, certify })}
          />
          <FieldLabel htmlFor="output-certify">
            Certify with the organisation&apos;s certificate
          </FieldLabel>
        </Field>
        <FieldDescription>
          An invisible PAdES certification signature proves the PDF came from this server unchanged.
          Filling in form fields and signing (DocuSign and the like) still work afterwards. Needs a
          certificate on the server (CERTIFY_* settings); without one, generations fail. Previews
          aren&apos;t certified.
        </FieldDescription>
      </FieldGroup>
    </fieldset>
  );
}
