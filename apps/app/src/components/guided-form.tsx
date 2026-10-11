import {
  evaluateCondition,
  type Field,
  type FieldSection,
  fieldErrors,
  isEmptyValue,
  type ScalarField,
  type TemplateData,
  templateDataSchema,
} from "@necodoc/shared";
import { useStore } from "@tanstack/react-form";
import { ImageIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useAppForm } from "@/components/form";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field as FieldBox,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

// Spec: docs/features/template-fields-and-guided-form.md. Renders a template's fields as a form,
// validated with the same templateDataSchema the API applies, so what passes here passes there.
// Used for sample data in the template editor, and by the fill flow and share links.

type Values = Record<string, unknown>;
type ScalarValue = string | number | boolean | string[];

const isRecord = (value: unknown): value is Values =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultOf = (field: Field) => ("default" in field ? field.default : undefined);

/** A new repeating group item: its children's defaults. */
const newItem = (fields: readonly ScalarField[]): Values =>
  Object.fromEntries(
    fields.flatMap((field) => {
      const value = defaultOf(field);
      return value === undefined ? [] : [[field.key, value]];
    }),
  );

/** Field defaults, then what the caller already has. Groups start empty. */
function initialValues(sections: readonly FieldSection[], given: Readonly<Values> = {}): Values {
  const out: Values = {};
  for (const field of sections.flatMap((s) => s.fields)) {
    const value = field.type === "group" ? [] : defaultOf(field);
    if (value !== undefined) out[field.key] = value;
  }
  return { ...out, ...given };
}

/**
 * Keys of the fields that show, walking in order like the API's validator: a show-if only sees
 * earlier fields that are themselves visible. `seen` collects those values as it goes.
 */
function shownKeys(fields: readonly Field[], values: Readonly<Values>, seen: Values, gate = true) {
  const shown = new Set<string>();
  for (const field of fields) {
    if (!gate || (field.showIf && !evaluateCondition(field.showIf, seen))) continue;
    shown.add(field.key);
    const value = values[field.key];
    if (!isEmptyValue(value) || field.type === "boolean") seen[field.key] = value;
  }
  return shown;
}

function visibility(sections: readonly FieldSection[], values: Readonly<Values>) {
  const seen: Values = {};
  return sections.map((section) => {
    const open = !section.showIf || evaluateCondition(section.showIf, seen);
    return { open, shown: shownKeys(section.fields, values, seen, open) };
  });
}

export type GuidedFormProps = {
  sections: readonly FieldSection[];
  /** Values to start from, e.g. saved sample data. Remount (change `key`) to load new ones. */
  defaultValues?: Readonly<Values>;
  /** `steps`: one section per step with progress. `all`: every section on one page. */
  layout?: "steps" | "all";
  /** Every change, valid or not, as raw values (sample data, live previews). */
  onChange?: (values: Values) => void;
  /** Valid data only: hidden fields dropped, defaults applied. Without it there's no submit. */
  onSubmit?: (data: TemplateData) => unknown;
  submitLabel?: string;
  disabled?: boolean;
  /** Show every error from the start, not only on touched fields (sample data). */
  revealErrors?: boolean;
};

export function GuidedForm({
  sections,
  defaultValues,
  layout = "steps",
  onChange,
  onSubmit,
  submitLabel = "Submit",
  disabled,
  revealErrors = false,
}: GuidedFormProps) {
  const schema = useMemo(() => templateDataSchema(sections), [sections]);
  /** Shows every error, touched or not, after a blocked Next or submit. */
  const [reveal, setReveal] = useState(revealErrors);
  const [step, setStep] = useState(0);
  const form = useAppForm({
    defaultValues: initialValues(sections, defaultValues),
    listeners: { onChange: ({ formApi }) => onChange?.(formApi.state.values) },
    onSubmit: async ({ value }) => {
      const parsed = schema.safeParse(value);
      if (parsed.success) return onSubmit?.(parsed.data);
      setReveal(true);
      // Jump back to the first step with an error.
      const bad = new Set(Object.keys(fieldErrors(parsed.error)).map((p) => p.split(".")[0]));
      const open = visibility(sections, value).flatMap((v, i) => (v.open ? [i] : []));
      const first = open.findIndex((i) => sections[i]?.fields.some((f) => bad.has(f.key)));
      if (first !== -1) setStep(first);
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const errors = useMemo(() => {
    const parsed = schema.safeParse(values);
    return parsed.success ? {} : fieldErrors(parsed.error);
  }, [schema, values]);
  const visible = visibility(sections, values);

  if (!sections.some((s) => s.fields.length)) {
    return (
      <p className="text-sm text-muted-foreground">This template doesn't declare any fields.</p>
    );
  }

  const scalar = (field: ScalarField, name: string, errorKey: string) => (
    <form.Field key={name} name={name}>
      {(api) => {
        const messages = errors[errorKey];
        const invalid = !!messages && (api.state.meta.isTouched || reveal);
        const input = (
          <ScalarInput
            field={field}
            id={name}
            value={api.state.value}
            onChange={(value) => {
              api.handleChange(value);
              api.handleBlur();
            }}
            onBlur={api.handleBlur}
            invalid={invalid}
            disabled={disabled}
          />
        );
        return (
          <FieldBox
            data-invalid={invalid}
            orientation={field.type === "boolean" ? "horizontal" : "vertical"}
          >
            {field.type === "boolean" && input}
            <FieldLabel htmlFor={name} className={field.type === "boolean" ? "font-normal" : ""}>
              {field.label}
              {field.required && <span className="text-destructive">*</span>}
            </FieldLabel>
            {field.type !== "boolean" && input}
            {field.help && <FieldDescription>{field.help}</FieldDescription>}
            {invalid && <FieldError errors={messages.map((message) => ({ message }))} />}
          </FieldBox>
        );
      }}
    </form.Field>
  );

  const group = (field: Extract<Field, { type: "group" }>) => (
    <form.Field key={field.key} name={field.key}>
      {(api) => {
        const items = Array.isArray(api.state.value) ? api.state.value : [];
        const messages = errors[field.key];
        const full = field.maxItems !== undefined && items.length >= field.maxItems;
        return (
          <FieldSet>
            <FieldLegend variant="label">
              {field.label}
              {field.required && <span className="text-destructive">*</span>}
            </FieldLegend>
            {field.help && <FieldDescription>{field.help}</FieldDescription>}
            {items.map((item, i) => {
              const row = isRecord(item) ? item : {};
              const shown = shownKeys(field.fields, row, {});
              return (
                // Items have no ids; inputs are controlled, so index keys are safe.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <div key={i} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {field.label} {i + 1}
                    </span>
                    {!disabled && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${field.label} ${i + 1}`}
                        onClick={() => api.handleChange(items.filter((_, j) => j !== i))}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                  {field.fields
                    .filter((child) => shown.has(child.key))
                    .map((child) =>
                      scalar(
                        child,
                        `${field.key}[${i}].${child.key}`,
                        `${field.key}.${i}.${child.key}`,
                      ),
                    )}
                </div>
              );
            })}
            {!disabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={full}
                onClick={() => api.handleChange([...items, newItem(field.fields)])}
              >
                <PlusIcon />
                Add {field.label.toLowerCase()}
              </Button>
            )}
            {messages && (api.state.meta.isTouched || reveal || items.length > 0) && (
              <FieldError errors={messages.map((message) => ({ message }))} />
            )}
          </FieldSet>
        );
      }}
    </form.Field>
  );

  const section = (index: number) => {
    const { title, description, fields } = sections[index] ?? { title: "", fields: [] };
    const shown = visible[index]?.shown ?? new Set<string>();
    return (
      <FieldSet key={index}>
        <FieldLegend>{title}</FieldLegend>
        {description && <FieldDescription>{description}</FieldDescription>}
        <FieldGroup>
          {fields
            .filter((field) => shown.has(field.key))
            .map((field) =>
              field.type === "group" ? group(field) : scalar(field, field.key, field.key),
            )}
        </FieldGroup>
      </FieldSet>
    );
  };

  const steps = sections.flatMap((_, i) => (visible[i]?.open ? [i] : []));
  const current = Math.min(step, steps.length - 1);
  const currentIndex = steps[current] ?? 0;
  const last = current === steps.length - 1;
  /** Errors in the current step's fields block Next. */
  const stepHasErrors = () => {
    const keys = new Set(sections[currentIndex]?.fields.map((f) => f.key));
    return Object.keys(errors).some((path) => keys.has(path.split(".")[0] ?? ""));
  };

  const submit = onSubmit && (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => (
        <Button type="submit" disabled={disabled || submitting}>
          {submitLabel}
        </Button>
      )}
    </form.Subscribe>
  );

  let body: ReactNode;
  if (layout === "all") {
    body = (
      <>
        {steps.map(section)}
        {submit}
      </>
    );
  } else {
    body = (
      <>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Step {current + 1} of {steps.length}
            </span>
            <span>{sections[currentIndex]?.title}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((current + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
        {section(currentIndex)}
        <div className="flex gap-2">
          {current > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(current - 1)}>
              Back
            </Button>
          )}
          {!last && (
            <Button
              type="button"
              onClick={() => {
                if (stepHasErrors()) return setReveal(true);
                setReveal(revealErrors);
                setStep(current + 1);
              }}
            >
              Next
            </Button>
          )}
          {last && submit}
        </div>
      </>
    );
  }

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      {body}
      {reveal && Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Fix the highlighted fields{layout === "steps" ? "" : " above"}.
        </p>
      )}
    </form>
  );
}

/**
 * The input for one scalar value. Also used where a value is picked outside a form: field
 * defaults and show-if values in the field designer. Empty input reports undefined.
 */
export function ScalarInput({
  field,
  id,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
}: {
  field: ScalarField;
  id: string;
  value: unknown;
  onChange: (value: ScalarValue | undefined) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const text = typeof value === "string" ? value : "";
  const common = { id, onBlur, disabled, "aria-invalid": invalid };
  switch (field.type) {
    case "text":
    case "email":
      return (
        <Input
          {...common}
          type={field.type === "email" ? "email" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "long_text":
      return (
        <Textarea
          {...common}
          rows={4}
          value={text}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "number":
      return (
        <Input
          {...common}
          type="number"
          step={field.decimals === undefined ? "any" : 10 ** -field.decimals}
          value={typeof value === "number" ? value : ""}
          onChange={(e) =>
            onChange(Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)
          }
        />
      );
    case "date":
      return (
        <Input
          {...common}
          type="date"
          min={field.min}
          max={field.max}
          className="w-auto"
          value={text}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "boolean":
      return (
        <Checkbox
          id={id}
          disabled={disabled}
          aria-invalid={invalid}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case "choice": {
      if (!field.multiple) {
        return (
          <NativeSelect
            {...common}
            className="w-full"
            value={text}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            <NativeSelectOption value="">Choose…</NativeSelectOption>
            {field.options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        );
      }
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2" id={id}>
          {field.options.map((option) => (
            <FieldBox key={option.value} orientation="horizontal">
              <Checkbox
                id={`${id}-${option.value}`}
                disabled={disabled}
                checked={picked.includes(option.value)}
                onCheckedChange={(checked) => {
                  const next = field.options
                    .map((o) => o.value)
                    .filter((v) => (v === option.value ? checked : picked.includes(v)));
                  onChange(next.length ? next : undefined);
                }}
              />
              <FieldLabel htmlFor={`${id}-${option.value}`} className="font-normal">
                {option.label}
              </FieldLabel>
            </FieldBox>
          ))}
        </div>
      );
    }
    case "image":
      return (
        <ImageInput
          id={id}
          value={text || undefined}
          onChange={onChange}
          disabled={disabled}
          invalid={invalid}
        />
      );
    case "signature":
      return (
        <SignaturePad
          id={id}
          value={text || undefined}
          onChange={onChange}
          disabled={disabled}
          invalid={invalid}
        />
      );
  }
}

/** Uploads stay in the browser: the file becomes a `data:` URL value. */
function ImageInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {value ? (
          <img src={value} alt="" className="size-full object-contain" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <Input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") onChange(reader.result);
          };
          reader.readAsDataURL(file);
        }}
      />
      {value && !disabled && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          Remove
        </Button>
      )}
    </div>
  );
}
