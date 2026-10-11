import type { Condition, ScalarField } from "@necodoc/shared";
import type { FieldChoice } from "@/components/editor/context";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { dayjs } from "@/lib/date";

// One field compared with a value (docs/features/template-fields-and-guided-form.md): show-ifs
// in the field designer and conditional sections in the editor both use it.

type Op = Condition["op"];

/** The comparisons that make sense for a field type, in plain words. */
function opsFor(field: ScalarField): { op: Op; label: string }[] {
  if (field.type === "boolean") {
    return [
      { op: "is_set", label: "is ticked" },
      { op: "not_equals", label: "is not ticked" },
    ];
  }
  const list = field.type === "choice" && field.multiple;
  const ops: { op: Op; label: string }[] = [
    { op: "is_set", label: "is filled in" },
    { op: "equals", label: list ? "includes" : "is" },
    { op: "not_equals", label: list ? "doesn't include" : "is not" },
  ];
  if (field.type === "choice") ops.push({ op: "one_of", label: "is one of" });
  if (field.type === "number") {
    ops.push({ op: "gt", label: "is more than" }, { op: "lt", label: "is less than" });
  }
  if (field.type === "date") {
    ops.push({ op: "gt", label: "is after" }, { op: "lt", label: "is before" });
  }
  return ops;
}

const firstOption = (field: ScalarField) =>
  field.type === "choice" ? (field.options[0]?.value ?? "") : "";

/** A fresh condition for a field and comparison, with a sensible starting value. */
export function newCondition(choice: FieldChoice, op: Op = "is_set"): Condition {
  const { path: field, field: def } = choice;
  switch (op) {
    case "is_set":
      return { field, op };
    case "equals":
    case "not_equals":
      return {
        field,
        op,
        value: def.type === "boolean" ? true : def.type === "number" ? 0 : firstOption(def),
      };
    case "one_of":
      return { field, op, values: [firstOption(def)] };
    case "gt":
    case "lt":
      return { field, op, value: def.type === "number" ? 0 : dayjs().format("YYYY-MM-DD") };
  }
}

export function ConditionEditor({
  id,
  value,
  onChange,
  fields,
  disabled,
}: {
  id: string;
  /** Null until a field is picked (e.g. a conditional section added before any fields). */
  value: Condition | null;
  onChange: (condition: Condition) => void;
  /** The fields this condition may refer to (earlier ones, for show-ifs). */
  fields: readonly FieldChoice[];
  disabled?: boolean;
}) {
  const choice = value && fields.find((f) => f.path === value.field);
  const ops = choice ? opsFor(choice.field) : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        id={id}
        size="sm"
        aria-label="Condition field"
        disabled={disabled}
        value={value?.field ?? ""}
        aria-invalid={!choice}
        onChange={(e) => {
          const next = fields.find((f) => f.path === e.target.value);
          if (next) onChange(newCondition(next));
        }}
      >
        {!choice && (
          <NativeSelectOption value={value?.field ?? ""}>
            {value ? `Missing field "${value.field}"` : "Pick a field"}
          </NativeSelectOption>
        )}
        {fields.map((f) => (
          <NativeSelectOption key={f.path} value={f.path}>
            {f.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {choice && (
        <NativeSelect
          size="sm"
          aria-label="Condition comparison"
          disabled={disabled}
          value={value.op}
          onChange={(e) => {
            const op = ops.find((o) => o.op === e.target.value)?.op;
            if (op) onChange(newCondition(choice, op));
          }}
        >
          {ops.map((o) => (
            <NativeSelectOption key={o.op} value={o.op}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      {value && choice && (
        <ConditionValue
          condition={value}
          field={choice.field}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function ConditionValue({
  condition,
  field,
  onChange,
  disabled,
}: {
  condition: Condition;
  field: ScalarField;
  onChange: (condition: Condition) => void;
  disabled?: boolean;
}) {
  if (condition.op === "is_set" || field.type === "boolean") return null;
  if (condition.op === "one_of") {
    if (field.type !== "choice") return null;
    return (
      <div className="flex flex-wrap gap-3">
        {field.options.map((option) => {
          const checkboxId = `${condition.field}-is-${option.value}`;
          return (
            <Field key={option.value} orientation="horizontal" className="w-auto">
              <Checkbox
                id={checkboxId}
                disabled={disabled}
                checked={condition.values.includes(option.value)}
                onCheckedChange={(checked) => {
                  const values = field.options
                    .map((o) => o.value)
                    .filter((v) => (v === option.value ? checked : condition.values.includes(v)));
                  // one_of needs at least one value; unticking the last one is ignored.
                  if (values.length) onChange({ ...condition, values });
                }}
              />
              <FieldLabel htmlFor={checkboxId} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          );
        })}
      </div>
    );
  }
  const { value } = condition;
  if (field.type === "choice") {
    return (
      <NativeSelect
        size="sm"
        aria-label="Condition value"
        disabled={disabled}
        value={String(value)}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
      >
        {field.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  if (field.type === "number") {
    return (
      <Input
        type="number"
        aria-label="Condition value"
        className="h-7 w-28"
        disabled={disabled}
        value={typeof value === "number" ? value : ""}
        onChange={(e) =>
          onChange({
            ...condition,
            value: Number.isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber,
          })
        }
      />
    );
  }
  return (
    <Input
      type={field.type === "date" ? "date" : "text"}
      aria-label="Condition value"
      className="h-7 w-auto"
      disabled={disabled}
      value={String(value)}
      onChange={(e) => onChange({ ...condition, value: e.target.value })}
    />
  );
}
