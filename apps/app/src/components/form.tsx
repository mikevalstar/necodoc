import { type Role, roleSchema } from "@necodoc/shared";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

/** For one-off field components that live next to the form using them. */
export { useFieldContext };

/** Label, the control, then the field's errors once touched. */
export function FieldShell({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: (props: { id: string; invalid: boolean; onBlur: () => void }) => ReactNode;
}) {
  const field = useFieldContext<unknown>();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {children({ id: field.name, invalid, onBlur: field.handleBlur })}
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}

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

/** Numbers as typed; an empty or partial entry becomes NaN and fails the schema. */
function NumberField({ label, step = 0.5 }: { label: string; step?: number }) {
  const field = useFieldContext<number>();
  return (
    <FieldShell label={label}>
      {({ id, invalid, onBlur }) => (
        <Input
          id={id}
          type="number"
          step={step}
          value={Number.isNaN(field.state.value) ? "" : field.state.value}
          onChange={(e) => field.handleChange(e.target.valueAsNumber)}
          onBlur={onBlur}
          aria-invalid={invalid}
        />
      )}
    </FieldShell>
  );
}

/** Code and long text. `mono` for HTML, CSS and JSON. */
function TextareaField({
  label,
  description,
  mono,
  rows = 6,
}: {
  label: string;
  description?: string;
  mono?: boolean;
  rows?: number;
}) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label} description={description}>
      {({ id, invalid, onBlur }) => (
        <Textarea
          id={id}
          rows={rows}
          spellCheck={!mono}
          className={cn(mono && "font-mono text-xs")}
          value={field.state.value}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={invalid}
        />
      )}
    </FieldShell>
  );
}

/** A `#rrggbb` colour: swatch picker plus the hex text. */
function ColorField({ label }: { label: string }) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label}>
      {({ id, invalid, onBlur }) => (
        <div className="flex gap-2">
          <input
            type="color"
            aria-label={`${label} swatch`}
            className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
            value={/^#[0-9a-f]{6}$/i.test(field.state.value) ? field.state.value : "#000000"}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          <Input
            id={id}
            className="font-mono"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={onBlur}
            aria-invalid={invalid}
          />
        </div>
      )}
    </FieldShell>
  );
}

function SwitchField({ label }: { label: string }) {
  const field = useFieldContext<boolean>();
  return (
    <Field orientation="horizontal">
      <Switch
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

/** A password input with a show/hide toggle, as `field.PasswordField`. */
function PasswordField({
  label,
  description,
  autoComplete,
}: {
  label: string;
  description?: string;
  autoComplete: ComponentProps<"input">["autoComplete"];
}) {
  const field = useFieldContext<string>();
  const [visible, setVisible] = useState(false);
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const descriptionId = `${field.name}-description`;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={field.name}
          name={field.name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={field.state.value}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
          aria-invalid={invalid}
          aria-describedby={description && !invalid ? descriptionId : undefined}
          className="pr-11"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1 right-1 text-ink-3"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeSlashIcon /> : <EyeIcon />}
        </Button>
      </div>
      {description && !invalid && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
      {invalid && <FieldError errors={field.state.meta.errors} />}
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
  fieldComponents: {
    TextField,
    RolesField,
    CheckboxField,
    NumberField,
    TextareaField,
    ColorField,
    SwitchField,
    PasswordField,
  },
  formComponents: {},
});
