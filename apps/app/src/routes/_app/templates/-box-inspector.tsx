import {
  type AcroField,
  barcodeSymbologies,
  bindNewField,
  bundledFonts,
  type FieldSection,
  type OverlayBox,
  type OverlayBoxType,
  overlayBoxSchema,
  overlayBoxTypes,
  type Signer,
  signingKindLabels,
  signingKinds,
  type TextStyle,
} from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { assetsQuery } from "@/lib/queries";

// Spec: docs/features/pdf-overlay-templates.md (box types, options, mapping). One box's settings.

export const boxTypeLabels: Record<OverlayBoxType, string> = {
  text: "Text",
  multiline: "Multiline text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  image: "Image",
  signature: "Signature",
  qrcode: "QR code",
  barcode: "Barcode",
};

/** Changing type keeps where the box is, its value and its form field; type options reset. */
const retype = (box: OverlayBox, type: OverlayBoxType) =>
  overlayBoxSchema.parse({
    type,
    id: box.id,
    page: box.page,
    rect: box.rect,
    value: box.value,
    ...(box.acroField ? { acroField: box.acroField } : {}),
    ...("style" in box ? { style: box.style } : {}),
  });

const rectLabels = { x: "X", y: "Y", width: "Width", height: "Height" } as const;

const num = (value: string, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function BoxInspector({
  box,
  pages,
  sections,
  signers,
  acroFields,
  editable,
  onChange,
  onSections,
  onDelete,
  onDuplicate,
}: {
  box: OverlayBox;
  pages: number;
  sections: FieldSection[];
  /** The template's signers (Signing panel), for signature boxes. */
  signers: readonly Signer[];
  acroFields: readonly AcroField[];
  editable: boolean;
  onChange: (box: OverlayBox) => void;
  /** Creating a field changes the sections and binds the box in one step. */
  onSections: (box: OverlayBox, sections: FieldSection[]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const fonts = useQuery(assetsQuery({ kind: "font" }));
  const [newLabel, setNewLabel] = useState("");
  const fields = sections.flatMap((s) => s.fields).filter((f) => f.type !== "group");
  const setStyle = (style: Partial<TextStyle>) => {
    if ("style" in box) onChange({ ...box, style: { ...box.style, ...style } });
  };
  const id = (name: string) => `box-${box.id}-${name}`;
  const fillable = acroFields.filter((f) => f.type !== "button");

  return (
    <fieldset disabled={!editable} className="space-y-4">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Box type"
          value={box.type}
          onChange={(e) => {
            const type = overlayBoxTypes.find((t) => t === e.target.value);
            if (type) onChange(retype(box, type));
          }}
        >
          {overlayBoxTypes.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {boxTypeLabels[type]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button variant="ghost" size="icon-sm" aria-label="Duplicate box" onClick={onDuplicate}>
          <CopyIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete box" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>

      <FieldGroup className="gap-4">
        {/* A signer's box is left blank for the e-sign provider: its value is never drawn. */}
        {!(box.type === "signature" && box.signerId) && (
          <Field>
            <FieldLabel>Value (Liquid)</FieldLabel>
            <CodeEditor
              label="Box value"
              language="liquid"
              sections={sections}
              value={box.value}
              readOnly={!editable}
              placeholder="{{ field_key }}"
              onChange={(value) => onChange({ ...box, value })}
              className="[&_.cm-editor]:min-h-12"
            />
            <NativeSelect
              aria-label="Bind to a field"
              value=""
              onChange={(e) => {
                const key = e.target.value;
                if (key)
                  onChange({
                    ...box,
                    value:
                      box.type === "date" ? `{{ ${key} | date: "MM/DD/YYYY" }}` : `{{ ${key} }}`,
                  });
              }}
            >
              <NativeSelectOption value="">Bind to a field…</NativeSelectOption>
              {fields.map((f) => (
                <NativeSelectOption key={f.key} value={f.key}>
                  {f.label} ({f.key})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className="flex gap-2">
              <Input
                aria-label="New field label"
                placeholder="New field label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!newLabel.trim()}
                onClick={() => {
                  const bound = bindNewField(box, newLabel, sections);
                  onSections(bound.box, bound.sections);
                  setNewLabel("");
                }}
              >
                Create field
              </Button>
            </div>
          </Field>
        )}

        {fillable.length > 0 && (
          <Field>
            <FieldLabel htmlFor={id("acro")}>Form field</FieldLabel>
            <NativeSelect
              id={id("acro")}
              value={box.acroField ?? ""}
              onChange={(e) => {
                const { acroField: _a, ...rest } = box;
                onChange(e.target.value ? { ...box, acroField: e.target.value } : { ...rest });
              }}
            >
              <NativeSelectOption value="">None: draw on the page</NativeSelectOption>
              {fillable.map((f) => (
                <NativeSelectOption key={f.name} value={f.name}>
                  {f.name} (p{f.page}, {f.type})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Fills the PDF's own field by name instead of drawing.
            </FieldDescription>
          </Field>
        )}

        {"style" in box && (
          <div className="grid grid-cols-2 gap-2">
            <Field className="col-span-2">
              <FieldLabel htmlFor={id("font")}>Font</FieldLabel>
              <NativeSelect
                id={id("font")}
                value={typeof box.style.font === "string" ? box.style.font : box.style.font.assetId}
                onChange={(e) => {
                  const value = e.target.value;
                  const bundled = Object.keys(bundledFonts).find((k) => k === value);
                  setStyle({
                    font: bundled ? (bundled as keyof typeof bundledFonts) : { assetId: value },
                  });
                }}
              >
                {Object.entries(bundledFonts).map(([key, font]) => (
                  <NativeSelectOption key={key} value={key}>
                    {font.family}
                  </NativeSelectOption>
                ))}
                {(fonts.data ?? [])
                  .filter((a) => a.mimeType !== "font/woff2")
                  .map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("size")}>Size (pt)</FieldLabel>
              <Input
                id={id("size")}
                type="number"
                min={4}
                max={96}
                step={0.5}
                value={box.style.size}
                onChange={(e) => setStyle({ size: num(e.target.value, box.style.size) })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={id("min")}>Shrink to (pt)</FieldLabel>
              <Input
                id={id("min")}
                type="number"
                min={2}
                max={96}
                step={0.5}
                disabled={!box.style.autoShrink}
                value={box.style.minSize}
                onChange={(e) => setStyle({ minSize: num(e.target.value, box.style.minSize) })}
              />
            </Field>
            <Field orientation="horizontal" className="col-span-2">
              <Switch
                id={id("shrink")}
                checked={box.style.autoShrink}
                onCheckedChange={(autoShrink) => setStyle({ autoShrink })}
              />
              <FieldLabel htmlFor={id("shrink")}>Shrink to fit</FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("align")}>Align</FieldLabel>
              <NativeSelect
                id={id("align")}
                value={box.style.align}
                onChange={(e) =>
                  setStyle({
                    align:
                      e.target.value === "center"
                        ? "center"
                        : e.target.value === "right"
                          ? "right"
                          : "left",
                  })
                }
              >
                <NativeSelectOption value="left">Left</NativeSelectOption>
                <NativeSelectOption value="center">Centre</NativeSelectOption>
                <NativeSelectOption value="right">Right</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("valign")}>Vertical</FieldLabel>
              <NativeSelect
                id={id("valign")}
                value={box.style.valign}
                onChange={(e) =>
                  setStyle({
                    valign:
                      e.target.value === "top"
                        ? "top"
                        : e.target.value === "bottom"
                          ? "bottom"
                          : "middle",
                  })
                }
              >
                <NativeSelectOption value="top">Top</NativeSelectOption>
                <NativeSelectOption value="middle">Middle</NativeSelectOption>
                <NativeSelectOption value="bottom">Bottom</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("color")}>Colour</FieldLabel>
              <Input
                id={id("color")}
                type="color"
                value={box.style.color}
                onChange={(e) => setStyle({ color: e.target.value })}
              />
            </Field>
          </div>
        )}

        {box.type === "checkbox" && (
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor={id("mark")}>Mark</FieldLabel>
              <NativeSelect
                id={id("mark")}
                value={box.mark}
                onChange={(e) =>
                  onChange({
                    ...box,
                    mark:
                      e.target.value === "cross"
                        ? "cross"
                        : e.target.value === "fill"
                          ? "fill"
                          : "check",
                  })
                }
              >
                <NativeSelectOption value="check">Tick</NativeSelectOption>
                <NativeSelectOption value="cross">Cross</NativeSelectOption>
                <NativeSelectOption value="fill">Filled square</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={id("mark-color")}>Colour</FieldLabel>
              <Input
                id={id("mark-color")}
                type="color"
                value={box.color}
                onChange={(e) => onChange({ ...box, color: e.target.value })}
              />
            </Field>
            <FieldDescription className="col-span-2">
              Drawn when the value isn't empty, false, 0 or no.
            </FieldDescription>
          </div>
        )}

        {box.type === "barcode" && (
          <Field>
            <FieldLabel htmlFor={id("symbology")}>Symbology</FieldLabel>
            <NativeSelect
              id={id("symbology")}
              value={box.symbology}
              onChange={(e) => {
                const symbology = barcodeSymbologies.find((s) => s === e.target.value);
                if (symbology) onChange({ ...box, symbology });
              }}
            >
              {barcodeSymbologies.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {s}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}

        {box.type === "signature" && (
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor={id("signer")}>Signer</FieldLabel>
              <NativeSelect
                id={id("signer")}
                value={box.signerId ?? ""}
                onChange={(e) => {
                  const { signerId: _s, signingKind: _k, required: _r, ...rest } = box;
                  const signerId = e.target.value;
                  onChange(signerId ? { ...rest, signerId, signingKind: "signature" } : rest);
                }}
              >
                <NativeSelectOption value="">None: draw the image</NativeSelectOption>
                {/* A box saved for a signer since removed still shows it. */}
                {box.signerId && !signers.some((s) => s.id === box.signerId) && (
                  <NativeSelectOption value={box.signerId}>
                    {box.signerId} (missing)
                  </NativeSelectOption>
                )}
                {signers.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.role}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {box.signerId && (
              <Field>
                <FieldLabel htmlFor={id("signing")}>Kind</FieldLabel>
                <NativeSelect
                  id={id("signing")}
                  value={box.signingKind ?? "signature"}
                  onChange={(e) => {
                    const kind = signingKinds.find((k) => k === e.target.value);
                    if (kind) onChange({ ...box, signingKind: kind });
                  }}
                >
                  {signingKinds.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {signingKindLabels[k]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {box.signerId && (
              <Field orientation="horizontal" className="col-span-2">
                <Switch
                  id={id("required")}
                  checked={box.required ?? true}
                  onCheckedChange={(required) => onChange({ ...box, required })}
                />
                <FieldLabel htmlFor={id("required")}>Required</FieldLabel>
              </Field>
            )}
            <FieldDescription className="col-span-2">
              {box.signerId
                ? "Left blank in the PDF and listed in the signing package for the e-sign provider."
                : "Draws the signature image in the value. Pick a signer to hand the box to an e-sign provider instead (add signers in the Signing panel)."}
            </FieldDescription>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field className="col-span-2 max-w-28">
            <FieldLabel htmlFor={id("page")}>Page</FieldLabel>
            <Input
              id={id("page")}
              type="number"
              min={1}
              max={pages}
              value={box.page}
              onChange={(e) =>
                onChange({
                  ...box,
                  page: Math.min(pages, Math.max(1, Math.round(num(e.target.value, box.page)))),
                })
              }
            />
          </Field>
          {(["x", "y", "width", "height"] as const).map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={id(key)}>{rectLabels[key]}</FieldLabel>
              <Input
                id={id(key)}
                type="number"
                step={0.5}
                className="tabular-nums"
                // Dragging leaves long fractions; two decimals of a point is plenty to read.
                value={Math.round(box.rect[key] * 100) / 100}
                onChange={(e) => {
                  const value = num(e.target.value, box.rect[key]);
                  if ((key === "width" || key === "height") && value <= 0) return;
                  onChange({ ...box, rect: { ...box.rect, [key]: value } });
                }}
              />
            </Field>
          ))}
        </div>
        <FieldDescription>Points, from the page's bottom-left corner.</FieldDescription>
      </FieldGroup>
    </fieldset>
  );
}
