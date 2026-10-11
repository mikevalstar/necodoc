import {
  type SignBoxAttrs,
  signBoxNodeSchema,
  signingKindLabels,
  signingKinds,
} from "@necodoc/shared";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { PenLineIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEditorFields } from "./context";

// Spec: docs/features/signing-packages.md. An inline atom where a signer signs; compiled to a
// sized `data-sign` box the renderer locates. Attrs mirror signBoxNodeSchema (template-doc.ts).

export const newSignBox = (signerId: string): SignBoxAttrs => ({
  signerId,
  kind: "signature",
  width: 60,
  height: 15,
  required: true,
});

const { shape } = signBoxNodeSchema.shape.attrs;
const readAttrs = (attrs: Record<string, unknown>): SignBoxAttrs => ({
  signerId: typeof attrs.signerId === "string" ? attrs.signerId : "",
  kind: shape.kind.safeParse(attrs.kind).data ?? "signature",
  width: shape.width.safeParse(attrs.width).data ?? 60,
  height: shape.height.safeParse(attrs.height).data ?? 15,
  required: attrs.required !== false,
});

export const SignBox = Node.create({
  name: "signBox",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    const defaults = newSignBox("");
    return Object.fromEntries(
      Object.entries(defaults).map(([name, value]) => [name, { default: value, rendered: false }]),
    );
  },

  parseHTML() {
    return [{ tag: "span[data-sign-box]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-sign-box": "" })];
  },

  renderText({ node }) {
    return `[${signingKindLabels[readAttrs(node.attrs).kind]}: ${node.attrs.signerId}]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(SignBoxView, { as: "span" });
  },
});

function SignBoxView({ node, editor, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { signers } = useEditorFields();
  const [open, setOpen] = useState(false);
  const attrs = readAttrs(node.attrs);
  const signer = signers.find((s) => s.id === attrs.signerId);
  const update = (changes: Partial<SignBoxAttrs>) => updateAttributes(changes);
  return (
    <NodeViewWrapper as="span" className="mx-px">
      <Popover open={open && editor.isEditable} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<span />}
          nativeButton={false}
          title={signer ? `Sign box for ${signer.role}` : "Pick a signer"}
          // Roughly to scale (1 mm ≈ 3.78 px at 96 dpi), so the editor shows how much room it takes.
          style={{ width: `${attrs.width}mm`, height: `${attrs.height}mm` }}
          className={cn(
            "inline-flex max-w-full cursor-pointer items-end gap-1 rounded-sm border border-dashed px-1 pb-0.5 align-bottom text-[0.75em] leading-tight font-medium",
            signer
              ? "border-amber-500/70 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : "border-destructive/50 bg-destructive/10 text-destructive",
            selected && "ring-2 ring-ring",
          )}
        >
          <PenLineIcon className="size-3 shrink-0" />
          <span className="truncate">
            {signingKindLabels[attrs.kind]} · {signer?.role ?? (attrs.signerId || "no signer")}
            {!attrs.required && " (optional)"}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <Field>
            <FieldLabel htmlFor="sign-box-signer">Signer</FieldLabel>
            <NativeSelect
              id="sign-box-signer"
              className="w-full"
              value={attrs.signerId}
              onChange={(e) => update({ signerId: e.target.value })}
            >
              {!signer && (
                <NativeSelectOption value={attrs.signerId}>
                  {attrs.signerId ? `Missing: ${attrs.signerId}` : "Pick a signer"}
                </NativeSelectOption>
              )}
              {signers.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.role}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-box-kind">Kind</FieldLabel>
            <NativeSelect
              id="sign-box-kind"
              className="w-full"
              value={attrs.kind}
              onChange={(e) => {
                const kind = signingKinds.find((k) => k === e.target.value);
                if (kind) update({ kind });
              }}
            >
              {signingKinds.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {signingKindLabels[k]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(["width", "height"] as const).map((side) => (
              <Field key={side}>
                <FieldLabel htmlFor={`sign-box-${side}`}>
                  {side === "width" ? "Width" : "Height"} (mm)
                </FieldLabel>
                <Input
                  id={`sign-box-${side}`}
                  type="number"
                  min={shape[side].minValue ?? 1}
                  max={shape[side].maxValue ?? 250}
                  value={attrs[side]}
                  onChange={(e) => {
                    const mm = shape[side].safeParse(e.target.valueAsNumber);
                    if (mm.success) update({ [side]: mm.data });
                  }}
                />
              </Field>
            ))}
          </div>
          <Field orientation="horizontal">
            <Switch
              id="sign-box-required"
              checked={attrs.required}
              onCheckedChange={(required) => update({ required })}
            />
            <FieldLabel htmlFor="sign-box-required">Required</FieldLabel>
          </Field>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              setOpen(false);
              deleteNode();
            }}
          >
            Remove sign box
          </Button>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
