import { type Role, roleSchema } from "@necodoc/shared";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentProps } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

function TextField({
  label,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur">) {
  const field = useFieldContext<string>();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={invalid}
        {...props}
      />
      {invalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}

function RolesField() {
  const field = useFieldContext<Role[]>();
  return (
    <FieldSet>
      <FieldLegend variant="label">Roles</FieldLegend>
      <div className="grid grid-cols-2 gap-3">
        {roleSchema.options.map((role) => (
          <Field key={role} orientation="horizontal">
            <Checkbox
              id={`role-${role}`}
              checked={field.state.value.includes(role)}
              onCheckedChange={(checked) =>
                field.handleChange(
                  roleSchema.options.filter((r) =>
                    r === role ? checked : field.state.value.includes(r),
                  ),
                )
              }
            />
            <FieldLabel htmlFor={`role-${role}`} className="font-normal capitalize">
              {role}
            </FieldLabel>
          </Field>
        ))}
      </div>
    </FieldSet>
  );
}

function CheckboxField({ label }: { label: string }) {
  const field = useFieldContext<boolean>();
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
      />
      <FieldLabel htmlFor={field.name} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
}

/** Shows a failed request's message (e.g. the API's last-admin guard). */
export function ErrorAlert({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, RolesField, CheckboxField },
  formComponents: {},
});
