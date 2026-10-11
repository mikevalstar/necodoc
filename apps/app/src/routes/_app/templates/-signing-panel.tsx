import type { Signer } from "@necodoc/shared";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// Spec: docs/features/signing-packages.md. Who signs: each signer's id (what sign boxes name),
// role, routing order, and name and email as Liquid over the data.

/** The next free `signer_N` id. */
function nextId(signers: readonly Signer[]) {
  let n = signers.length + 1;
  while (signers.some((s) => s.id === `signer_${n}`)) n++;
  return `signer_${n}`;
}

export function SigningPanel({
  signers,
  kind,
  editable,
  onChange,
}: {
  signers: readonly Signer[];
  kind: "designed" | "overlay";
  editable: boolean;
  onChange: (signers: Signer[]) => void;
}) {
  const update = (i: number, changes: Partial<Signer>) =>
    onChange(signers.map((s, j) => (j === i ? { ...s, ...changes } : s)));
  return (
    <fieldset disabled={!editable} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every generation lists these signers and where their boxes landed, with JSON for DocuSign,
        Dropbox Sign or Adobe Sign (on the generation&apos;s page and through the API). necodoc
        doesn&apos;t collect signatures itself.{" "}
        {kind === "designed"
          ? "Add sign boxes from the editor's Insert menu or the / menu."
          : "Pick a signer on a signature box to hand it to the e-sign provider."}
      </p>
      {signers.map((signer, i) => (
        <FieldGroup
          // biome-ignore lint/suspicious/noArrayIndexKey: ids are edited in place; keys must hold
          key={i}
          className="grid grid-cols-[1fr_1fr_6rem_auto] gap-2 rounded-md border p-3"
        >
          <Field>
            <FieldLabel htmlFor={`signer-${i}-role`}>Role</FieldLabel>
            <Input
              id={`signer-${i}-role`}
              value={signer.role}
              placeholder="Principal"
              onChange={(e) => update(i, { role: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`signer-${i}-id`}>Id</FieldLabel>
            <Input
              id={`signer-${i}-id`}
              className="font-mono"
              value={signer.id}
              onChange={(e) => update(i, { id: e.target.value.trim() })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`signer-${i}-order`}>Order</FieldLabel>
            <Input
              id={`signer-${i}-order`}
              type="number"
              min={1}
              max={100}
              value={signer.routingOrder}
              onChange={(e) => {
                const order = e.target.valueAsNumber;
                if (Number.isInteger(order) && order >= 1) update(i, { routingOrder: order });
              }}
            />
          </Field>
          <Button
            variant="ghost"
            size="icon-sm"
            className="self-end"
            aria-label={`Remove ${signer.role || signer.id}`}
            onClick={() => onChange(signers.filter((_, j) => j !== i))}
          >
            <Trash2Icon />
          </Button>
          <Field className="col-span-2">
            <FieldLabel htmlFor={`signer-${i}-name`}>Name (Liquid)</FieldLabel>
            <Input
              id={`signer-${i}-name`}
              className="font-mono"
              placeholder={`{{ ${signer.id}_name }}`}
              value={signer.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor={`signer-${i}-email`}>Email (Liquid)</FieldLabel>
            <Input
              id={`signer-${i}-email`}
              className="font-mono"
              placeholder={`{{ ${signer.id}_email }}`}
              value={signer.email}
              onChange={(e) => update(i, { email: e.target.value })}
            />
          </Field>
        </FieldGroup>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...signers,
            {
              id: nextId(signers),
              role: `Signer ${signers.length + 1}`,
              routingOrder: (signers.at(-1)?.routingOrder ?? 0) + 1,
              name: "",
              email: "",
            },
          ])
        }
      >
        <PlusIcon /> Add signer
      </Button>
      <FieldDescription>
        Signers with the same order sign in parallel. Renaming an id doesn&apos;t update the boxes
        that name it.
      </FieldDescription>
    </fieldset>
  );
}
