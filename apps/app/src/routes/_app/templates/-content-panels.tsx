import { bandSchema, type FieldSection } from "@necodoc/shared";
import { DocEditor } from "@/components/editor/doc-editor";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type CodeBand, type EditorBand, type EditorContent, emptyDoc } from "./-draft";

// Spec: docs/features/document-templates.md. Body and bands, in the visual editor or as code.

type Props = {
  content: EditorContent;
  onChange: (content: EditorContent) => void;
  sections: readonly FieldSection[];
  editable: boolean;
};

export function BodyPanel({ content, onChange, sections, editable }: Props) {
  if (content.mode === "code") {
    return (
      <Field>
        <FieldLabel htmlFor="code-body">Body HTML (Liquid)</FieldLabel>
        <Textarea
          id="code-body"
          rows={28}
          spellCheck={false}
          className="font-mono text-xs"
          readOnly={!editable}
          value={content.body}
          onChange={(e) => onChange({ ...content, body: e.target.value })}
        />
        <FieldDescription>
          Fields are Liquid variables: {"{{ client_name }}"}, {"{% if %}"},{" "}
          {"{% for item in line_items %}"}. Filters: date, number, currency, qrcode, barcode,
          asset_url. No JavaScript, no remote URLs.
        </FieldDescription>
      </Field>
    );
  }
  return (
    <DocEditor
      value={content.body}
      onChange={(body) => onChange({ ...content, body })}
      sections={sections}
      editable={editable}
      className="min-h-[60svh]"
    />
  );
}

const BAND_DEFAULT_HEIGHT = { header: 20, footer: 12 } as const;
const MAX_HEIGHT = bandSchema.shape.height.maxValue ?? 200;

function HeightInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (height: number) => void;
  disabled: boolean;
}) {
  return (
    <Field className="w-40">
      <FieldLabel htmlFor={id}>Height (mm)</FieldLabel>
      <Input
        id={id}
        type="number"
        min={1}
        max={MAX_HEIGHT}
        step={1}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const height = e.target.valueAsNumber;
          if (height > 0 && height <= MAX_HEIGHT) onChange(height);
        }}
      />
    </Field>
  );
}

/** Header and footer: each its own document at a fixed height, with an optional page-1 variant. */
export function BandsPanel({ content, onChange, sections, editable }: Props) {
  return (
    <div className="space-y-8">
      {(["header", "footer"] as const).map((name) => {
        const label = name === "header" ? "Header" : "Footer";
        if (content.mode === "code") {
          const band = content[name];
          const set = (next: CodeBand | null) => onChange({ ...content, [name]: next });
          return (
            <FieldGroup key={name}>
              <Field orientation="horizontal">
                <Switch
                  id={`use-${name}`}
                  disabled={!editable}
                  checked={!!band}
                  onCheckedChange={(on) =>
                    set(on ? { html: "", height: BAND_DEFAULT_HEIGHT[name] } : null)
                  }
                />
                <FieldLabel htmlFor={`use-${name}`}>Use a {name}</FieldLabel>
              </Field>
              {band && (
                <>
                  <HeightInput
                    id={`${name}-height`}
                    value={band.height}
                    disabled={!editable}
                    onChange={(height) => set({ ...band, height })}
                  />
                  <Textarea
                    aria-label={`${label} HTML`}
                    rows={6}
                    spellCheck={false}
                    className="font-mono text-xs"
                    readOnly={!editable}
                    value={band.html}
                    onChange={(e) => set({ ...band, html: e.target.value })}
                  />
                  <Field orientation="horizontal">
                    <Switch
                      id={`${name}-first`}
                      disabled={!editable}
                      checked={band.firstPageHtml !== undefined}
                      onCheckedChange={(on) => {
                        const { firstPageHtml: _, ...rest } = band;
                        set(on ? { ...rest, firstPageHtml: band.html } : rest);
                      }}
                    />
                    <FieldLabel htmlFor={`${name}-first`}>Different first page</FieldLabel>
                  </Field>
                  {band.firstPageHtml !== undefined && (
                    <Textarea
                      aria-label={`First page ${name} HTML`}
                      rows={6}
                      spellCheck={false}
                      className="font-mono text-xs"
                      readOnly={!editable}
                      value={band.firstPageHtml}
                      onChange={(e) => set({ ...band, firstPageHtml: e.target.value })}
                    />
                  )}
                </>
              )}
            </FieldGroup>
          );
        }

        const band = content[name];
        const set = (next: EditorBand | null) => onChange({ ...content, [name]: next });
        return (
          <FieldGroup key={name}>
            <Field orientation="horizontal">
              <Switch
                id={`use-${name}`}
                disabled={!editable}
                checked={!!band}
                onCheckedChange={(on) =>
                  set(
                    on
                      ? { height: BAND_DEFAULT_HEIGHT[name], doc: emptyDoc, firstPage: null }
                      : null,
                  )
                }
              />
              <FieldLabel htmlFor={`use-${name}`}>Use a {name}</FieldLabel>
            </Field>
            {band && (
              <>
                <HeightInput
                  id={`${name}-height`}
                  value={band.height}
                  disabled={!editable}
                  onChange={(height) => set({ ...band, height })}
                />
                <FieldDescription>
                  Shown on every page{band.firstPage ? " after the first" : ""}, inside the page
                  margins; the body is pushed {name === "header" ? "down" : "up"} by the height.
                  Content taller than the height is cut off. Insert Field › Page number or Total
                  pages for "Page 1 of 3".
                </FieldDescription>
                <DocEditor
                  value={band.doc}
                  onChange={(doc) => set({ ...band, doc })}
                  sections={sections}
                  band
                  editable={editable}
                  placeholder={`${label} content, e.g. a logo, a title or page numbers…`}
                />
                <Field orientation="horizontal">
                  <Switch
                    id={`${name}-first`}
                    disabled={!editable}
                    checked={!!band.firstPage}
                    onCheckedChange={(on) => set({ ...band, firstPage: on ? emptyDoc : null })}
                  />
                  <FieldLabel htmlFor={`${name}-first`}>Different first page</FieldLabel>
                </Field>
                {band.firstPage && (
                  <>
                    <FieldDescription>
                      Page 1 only, e.g. a letterhead. It has the same height as the {name}.
                    </FieldDescription>
                    <DocEditor
                      value={band.firstPage}
                      onChange={(firstPage) => set({ ...band, firstPage })}
                      sections={sections}
                      band
                      editable={editable}
                      placeholder={`First page ${name}…`}
                    />
                  </>
                )}
              </>
            )}
          </FieldGroup>
        );
      })}
    </div>
  );
}
