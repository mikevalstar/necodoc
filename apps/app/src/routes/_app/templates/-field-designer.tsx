import {
  type Condition,
  type Field,
  type FieldSection,
  type FieldType,
  fieldSectionsSchema,
  isSensitiveField,
  RESERVED_FIELD_KEYS,
  type ScalarField,
} from "@necodoc/shared";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo, useState } from "react";
import { ConditionEditor, newCondition } from "@/components/condition-editor";
import type { FieldChoice } from "@/components/editor/context";
import { ScalarInput } from "@/components/guided-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field as FieldBox, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Spec: docs/features/template-fields-and-guided-form.md. Edits the template's sections and
// fields; problems come from fieldSectionsSchema itself, so the designer and the API agree.

export const fieldTypeLabels: Record<FieldType, string> = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  boolean: "Checkbox",
  choice: "Choice",
  email: "Email",
  image: "Image upload",
  signature: "Signature",
  group: "Repeating group",
};

const scalarTypes = (Object.keys(fieldTypeLabels) as FieldType[]).filter(
  (t): t is ScalarField["type"] => t !== "group",
);

/** "Policy holder name" → "policy_holder_name", kept to fieldKeySchema's rules. */
function slug(label: string) {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  const safe = /^[a-z]/.test(key) ? key : `f_${key}`;
  return (RESERVED_FIELD_KEYS as readonly string[]).includes(safe) ? `${safe}_value` : safe;
}

const uniqueKey = (base: string, taken: ReadonlySet<string>) => {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
};

/** Converts a field to another type, keeping what every field has. */
function scalarOfType(field: Field, type: ScalarField["type"]): ScalarField {
  const { key, label, help, required, showIf, sensitive } = field;
  const base = { key, label, help, required, showIf, sensitive };
  if (type === "choice") {
    return {
      ...base,
      type,
      multiple: false,
      options: [
        { value: "option_1", label: "Option 1" },
        { value: "option_2", label: "Option 2" },
      ],
    };
  }
  return { ...base, type };
}

function ofType(field: Field, type: FieldType): Field {
  if (type !== "group") return scalarOfType(field, type);
  const { key, label, help, required, showIf, sensitive } = field;
  return {
    key,
    label,
    help,
    required,
    showIf,
    sensitive,
    type,
    fields: [{ type: "text", key: "description", label: "Description", required: false }],
  };
}

/** Scalar fields as condition targets. */
const choicesOf = (fields: readonly Field[]): FieldChoice[] =>
  fields.flatMap((field) =>
    field.type === "group" ? [] : [{ path: field.key, label: field.label, field }],
  );

type Errors = ReadonlyMap<string, string[]>;

/** Messages exactly at `path`. */
const at = (errors: Errors, path: string) => errors.get(path) ?? [];
/** Whether anything at or under `path` has a problem. */
const under = (errors: Errors, path: string) =>
  [...errors.keys()].some((key) => key === path || key.startsWith(`${path}.`));

const move = <T,>(list: readonly T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
};

export function FieldDesigner({
  sections,
  onChange,
  disabled,
}: {
  sections: FieldSection[];
  onChange: (sections: FieldSection[]) => void;
  disabled?: boolean;
}) {
  const errors = useMemo<Errors>(() => {
    const parsed = fieldSectionsSchema.safeParse(sections);
    const map = new Map<string, string[]>();
    for (const issue of parsed.error?.issues ?? []) {
      const key = issue.path.map(String).join(".");
      map.set(key, [...(map.get(key) ?? []), issue.message]);
    }
    return map;
  }, [sections]);
  /** The one open field editor, by path ("s.i" or "s.i.c"). */
  const [open, setOpen] = useState<string | null>(null);

  const allKeys = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  const setSection = (s: number, section: FieldSection) =>
    onChange(sections.map((old, i) => (i === s ? section : old)));
  const setField = (s: number, i: number, field: Field) => {
    const section = sections[s];
    if (section)
      setSection(s, { ...section, fields: section.fields.map((f, j) => (j === i ? field : f)) });
  };

  const addField = (s: number, type: FieldType) => {
    const section = sections[s];
    if (!section) return;
    const label = `New ${fieldTypeLabels[type].toLowerCase()}`;
    const field = ofType(
      { type: "text", key: uniqueKey(slug(label), allKeys), label, required: false },
      type,
    );
    setSection(s, { ...section, fields: [...section.fields, field] });
    setOpen(`${s}.${section.fields.length}`);
  };

  return (
    <div className="space-y-4">
      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Fields are the data a document needs. Add a section, then its fields; each section is one
          step of the guided form.
        </p>
      )}
      {sections.map((section, s) => {
        const earlier = choicesOf(sections.slice(0, s).flatMap((x) => x.fields));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: sections have no ids; order is identity
          <section key={s} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Input
                  aria-label="Section title"
                  className="font-medium"
                  value={section.title}
                  disabled={disabled}
                  aria-invalid={at(errors, `${s}.title`).length > 0}
                  onChange={(e) => setSection(s, { ...section, title: e.target.value })}
                />
                <Messages messages={at(errors, `${s}.title`)} />
              </div>
              {!disabled && (
                <Reorder
                  label={`section ${section.title}`}
                  index={s}
                  count={sections.length}
                  onMove={(to) => onChange(move(sections, s, to))}
                  onDelete={() => onChange(sections.filter((_, i) => i !== s))}
                />
              )}
            </div>
            <Input
              aria-label="Section description"
              placeholder="Description (optional), shown above the section's fields"
              value={section.description ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setSection(s, { ...section, description: e.target.value || undefined })
              }
            />
            <ShowIf
              id={`section-${s}-showif`}
              value={section.showIf}
              choices={earlier}
              errors={at(errors, `${s}.showIf.field`)}
              disabled={disabled}
              onChange={(showIf) => setSection(s, { ...section, showIf })}
              what="this section"
            />
            <div className="space-y-2">
              {section.fields.map((field, i) => {
                const path = `${s}.${i}`;
                const errorPath = `${s}.fields.${i}`;
                const before = [
                  ...sections.slice(0, s).flatMap((x) => x.fields),
                  ...section.fields.slice(0, i),
                ];
                return (
                  <FieldRow
                    key={path}
                    field={field}
                    errorPath={errorPath}
                    errors={errors}
                    open={open === path}
                    onToggle={() => setOpen(open === path ? null : path)}
                    disabled={disabled}
                    onChange={(next) => setField(s, i, next)}
                    earlier={choicesOf(before)}
                    reorder={
                      <Reorder
                        label={field.label}
                        index={i}
                        count={section.fields.length}
                        onMove={(to) => {
                          setSection(s, { ...section, fields: move(section.fields, i, to) });
                          if (open === path) setOpen(`${s}.${to}`);
                        }}
                        onDelete={() => {
                          setSection(s, {
                            ...section,
                            fields: section.fields.filter((_, j) => j !== i),
                          });
                          setOpen(null);
                        }}
                      />
                    }
                    sectionPicker={
                      sections.length > 1 && (
                        <FieldBox>
                          <FieldLabel htmlFor={`${path}-section`}>Section</FieldLabel>
                          <NativeSelect
                            id={`${path}-section`}
                            className="w-full"
                            value={s}
                            onChange={(e) => {
                              const to = Number(e.target.value);
                              const target = sections[to];
                              if (!target || to === s) return;
                              onChange(
                                sections.map((x, k) =>
                                  k === s
                                    ? { ...x, fields: x.fields.filter((_, j) => j !== i) }
                                    : k === to
                                      ? { ...x, fields: [...x.fields, field] }
                                      : x,
                                ),
                              );
                              setOpen(`${to}.${target.fields.length}`);
                            }}
                          >
                            {sections.map((x, k) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: as above
                              <NativeSelectOption key={k} value={k}>
                                {x.title}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </FieldBox>
                      )
                    }
                  />
                );
              })}
            </div>
            {!disabled && (
              <AddField
                types={Object.keys(fieldTypeLabels) as FieldType[]}
                onAdd={(type) => addField(s, type)}
              />
            )}
          </section>
        );
      })}
      {!disabled && (
        <Button
          variant="outline"
          onClick={() =>
            onChange([
              ...sections,
              { title: sections.length ? "New section" : "Details", fields: [] },
            ])
          }
        >
          <PlusIcon weight="bold" />
          Add section
        </Button>
      )}
    </div>
  );
}

function AddField<T extends FieldType>({
  types,
  onAdd,
  label = "Add field",
}: {
  types: readonly T[];
  onAdd: (type: T) => void;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <PlusIcon weight="bold" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {types.map((type) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
            {fieldTypeLabels[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Reorder({
  label,
  index,
  count,
  onMove,
  onDelete,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUpIcon weight="bold" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${label} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDownIcon weight="bold" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${label}`} onClick={onDelete}>
        <TrashIcon />
      </Button>
    </div>
  );
}

function Messages({ messages }: { messages: readonly string[] }) {
  return messages.length ? <FieldError errors={messages.map((message) => ({ message }))} /> : null;
}

function ShowIf({
  id,
  value,
  choices,
  errors,
  disabled,
  onChange,
  what,
}: {
  id: string;
  value: Condition | undefined;
  choices: readonly FieldChoice[];
  errors: readonly string[];
  disabled?: boolean;
  onChange: (value: Condition | undefined) => void;
  what: string;
}) {
  const first = choices[0];
  return (
    <div className="space-y-1.5">
      <FieldBox orientation="horizontal">
        <Checkbox
          id={id}
          checked={!!value}
          disabled={disabled || (!value && !first)}
          onCheckedChange={(checked) =>
            onChange(checked && first ? newCondition(first) : undefined)
          }
        />
        <FieldLabel htmlFor={id} className="font-normal">
          Only show {what} if…
          {!value && !first && (
            <span className="text-muted-foreground">(needs an earlier field)</span>
          )}
        </FieldLabel>
      </FieldBox>
      {value && (
        <ConditionEditor
          id={`${id}-field`}
          value={value}
          onChange={onChange}
          fields={choices}
          disabled={disabled}
        />
      )}
      <Messages messages={errors} />
    </div>
  );
}

function FieldRow({
  field,
  errorPath,
  errors,
  open,
  onToggle,
  onChange,
  disabled,
  earlier,
  reorder,
  sectionPicker,
}: {
  field: Field;
  errorPath: string;
  errors: Errors;
  open: boolean;
  onToggle: () => void;
  onChange: (field: Field) => void;
  disabled?: boolean;
  /** Fields a show-if may refer to. */
  earlier: readonly FieldChoice[];
  reorder: ReactNode;
  sectionPicker?: ReactNode;
}) {
  const bad = under(errors, errorPath);
  return (
    <div className={cn("rounded-lg border", bad && "border-destructive/50")}>
      <div className="flex items-center gap-2 p-1.5 pl-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? (
            <CaretDownIcon weight="bold" className="size-4 shrink-0" />
          ) : (
            <CaretRightIcon weight="bold" className="size-4 shrink-0" />
          )}
          <span className="truncate font-medium">{field.label || "Untitled"}</span>
          <code className="truncate text-xs text-muted-foreground">{field.key}</code>
          <Badge variant="secondary" className="shrink-0">
            {fieldTypeLabels[field.type]}
          </Badge>
          {field.required && <Badge variant="outline">Required</Badge>}
          {field.showIf && <Badge variant="outline">Show if</Badge>}
          {isSensitiveField(field) && <Badge variant="outline">Sensitive</Badge>}
          {bad && <span className="text-xs text-destructive">Needs attention</span>}
        </button>
        {!disabled && reorder}
      </div>
      {open && (
        <FieldForm
          field={field}
          errorPath={errorPath}
          errors={errors}
          onChange={onChange}
          disabled={disabled}
          earlier={earlier}
          sectionPicker={sectionPicker}
        />
      )}
    </div>
  );
}

function OptionalNumber({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <FieldBox>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        onChange={(e) =>
          onChange(Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)
        }
      />
    </FieldBox>
  );
}

function FieldForm({
  field,
  errorPath,
  errors,
  onChange,
  disabled,
  earlier,
  sectionPicker,
}: {
  field: Field;
  errorPath: string;
  errors: Errors;
  onChange: (field: Field) => void;
  disabled?: boolean;
  earlier: readonly FieldChoice[];
  sectionPicker?: ReactNode;
}) {
  const id = `field-${errorPath}`;
  const err = (name: string) => at(errors, `${errorPath}.${name}`);
  const isGroupChild = errorPath.split(".").length > 3;
  const types: readonly FieldType[] = isGroupChild
    ? scalarTypes
    : (Object.keys(fieldTypeLabels) as FieldType[]);

  return (
    <fieldset disabled={disabled} className="grid gap-4 border-t p-3 sm:grid-cols-2">
      <FieldBox>
        <FieldLabel htmlFor={`${id}-label`}>Label</FieldLabel>
        <Input
          id={`${id}-label`}
          value={field.label}
          aria-invalid={err("label").length > 0}
          onChange={(e) => {
            const label = e.target.value;
            // The key follows the label until someone edits it by hand.
            const auto = field.key === slug(field.label) || /^new_/.test(field.key);
            onChange({ ...field, label, ...(auto && label.trim() ? { key: slug(label) } : {}) });
          }}
        />
        <Messages messages={err("label")} />
      </FieldBox>
      <FieldBox>
        <FieldLabel htmlFor={`${id}-key`}>Key</FieldLabel>
        <Input
          id={`${id}-key`}
          className="font-mono text-xs"
          value={field.key}
          aria-invalid={err("key").length > 0}
          onChange={(e) => onChange({ ...field, key: e.target.value })}
        />
        <FieldDescription>
          Used in merge fields and the API. Renaming flags old uses.
        </FieldDescription>
        <Messages messages={err("key")} />
      </FieldBox>
      <FieldBox>
        <FieldLabel htmlFor={`${id}-type`}>Type</FieldLabel>
        <NativeSelect
          id={`${id}-type`}
          className="w-full"
          value={field.type}
          onChange={(e) => {
            const type = types.find((t) => t === e.target.value);
            if (type && type !== field.type) onChange(ofType(field, type));
          }}
        >
          {types.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {fieldTypeLabels[type]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FieldBox>
      {sectionPicker}
      <FieldBox className="sm:col-span-2">
        <FieldLabel htmlFor={`${id}-help`}>Help text</FieldLabel>
        <Input
          id={`${id}-help`}
          value={field.help ?? ""}
          placeholder="Shown under the input"
          onChange={(e) => onChange({ ...field, help: e.target.value || undefined })}
        />
      </FieldBox>
      <FieldBox orientation="horizontal">
        <Switch
          id={`${id}-required`}
          checked={field.required}
          onCheckedChange={(required) => onChange({ ...field, required })}
        />
        <FieldLabel htmlFor={`${id}-required`} className="font-normal">
          {field.type === "boolean"
            ? "Must be ticked"
            : field.type === "group"
              ? "Needs at least one item"
              : "Required"}
        </FieldLabel>
      </FieldBox>
      <FieldBox>
        <FieldLabel htmlFor={`${id}-sensitive`}>Sensitive</FieldLabel>
        <NativeSelect
          id={`${id}-sensitive`}
          className="w-full"
          value={field.sensitive === undefined ? "auto" : field.sensitive ? "yes" : "no"}
          onChange={(e) => {
            const value = e.target.value;
            onChange({ ...field, sensitive: value === "auto" ? undefined : value === "yes" });
          }}
        >
          <NativeSelectOption value="auto">
            Automatic ({isSensitiveField({ ...field, sensitive: undefined }) ? "yes" : "no"})
          </NativeSelectOption>
          <NativeSelectOption value="yes">Yes</NativeSelectOption>
          <NativeSelectOption value="no">No</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>
          Masked in the audit log and in other people's log entries. PDFs keep the value.
        </FieldDescription>
      </FieldBox>
      <TypeSettings
        field={field}
        id={id}
        errorPath={errorPath}
        errors={errors}
        onChange={onChange}
        disabled={disabled}
      />
      {field.type !== "group" && field.type !== "image" && field.type !== "signature" && (
        <FieldBox className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-default`}>Default</FieldLabel>
          <ScalarInput
            field={field}
            id={`${id}-default`}
            value={field.default}
            invalid={err("default").length > 0}
            disabled={disabled}
            onChange={(value) => onChange(withDefault(field, value))}
          />
          <Messages messages={err("default")} />
        </FieldBox>
      )}
      <div className="sm:col-span-2">
        <ShowIf
          id={`${id}-showif`}
          value={field.showIf}
          choices={earlier}
          errors={err("showIf.field")}
          disabled={disabled}
          onChange={(showIf) => onChange({ ...field, showIf })}
          what="this field"
        />
      </div>
      <div className="sm:col-span-2">
        <Messages messages={at(errors, errorPath)} />
      </div>
    </fieldset>
  );
}

/** Sets a default only when its type fits the field; anything else clears it. */
function withDefault(
  field: Exclude<Field, { type: "group" | "image" | "signature" }>,
  value: unknown,
): Field {
  switch (field.type) {
    case "number":
      return { ...field, default: typeof value === "number" ? value : undefined };
    case "boolean":
      return { ...field, default: typeof value === "boolean" ? value || undefined : undefined };
    case "choice":
      return {
        ...field,
        default: typeof value === "string" || Array.isArray(value) ? value : undefined,
      };
    default:
      return { ...field, default: typeof value === "string" ? value : undefined };
  }
}

function TypeSettings({
  field,
  id,
  errorPath,
  errors,
  onChange,
  disabled,
}: {
  field: Field;
  id: string;
  errorPath: string;
  errors: Errors;
  onChange: (field: Field) => void;
  disabled?: boolean;
}) {
  const [openChild, setOpenChild] = useState<number | null>(null);
  switch (field.type) {
    case "text":
    case "long_text":
      return (
        <>
          <OptionalNumber
            id={`${id}-min`}
            label="Min length"
            value={field.minLength}
            onChange={(minLength) => onChange({ ...field, minLength })}
          />
          <OptionalNumber
            id={`${id}-max`}
            label="Max length"
            value={field.maxLength}
            onChange={(maxLength) => onChange({ ...field, maxLength })}
          />
          <FieldBox className="sm:col-span-2">
            <FieldLabel htmlFor={`${id}-pattern`}>Pattern (regular expression)</FieldLabel>
            <Input
              id={`${id}-pattern`}
              className="font-mono text-xs"
              placeholder="e.g. [A-Z]{2}-\d{6}"
              value={field.pattern ?? ""}
              onChange={(e) => onChange({ ...field, pattern: e.target.value || undefined })}
            />
            <Messages messages={at(errors, `${errorPath}.pattern`)} />
          </FieldBox>
        </>
      );
    case "number":
      return (
        <>
          <OptionalNumber
            id={`${id}-min`}
            label="Minimum"
            value={field.min}
            onChange={(min) => onChange({ ...field, min })}
          />
          <OptionalNumber
            id={`${id}-max`}
            label="Maximum"
            value={field.max}
            onChange={(max) => onChange({ ...field, max })}
          />
          <OptionalNumber
            id={`${id}-decimals`}
            label="Decimal places allowed"
            value={field.decimals}
            onChange={(decimals) =>
              onChange({
                ...field,
                decimals:
                  decimals === undefined
                    ? undefined
                    : Math.min(10, Math.max(0, Math.round(decimals))),
              })
            }
          />
        </>
      );
    case "date":
      return (
        <>
          {(["min", "max"] as const).map((bound) => (
            <FieldBox key={bound}>
              <FieldLabel htmlFor={`${id}-${bound}`}>
                {bound === "min" ? "Earliest" : "Latest"}
              </FieldLabel>
              <Input
                id={`${id}-${bound}`}
                type="date"
                value={field[bound] ?? ""}
                onChange={(e) => {
                  const date = e.target.value || undefined;
                  onChange(bound === "min" ? { ...field, min: date } : { ...field, max: date });
                }}
              />
            </FieldBox>
          ))}
        </>
      );
    case "choice":
      return (
        <>
          <FieldBox orientation="horizontal">
            <Switch
              id={`${id}-multiple`}
              checked={field.multiple}
              onCheckedChange={(multiple) => onChange({ ...field, multiple, default: undefined })}
            />
            <FieldLabel htmlFor={`${id}-multiple`} className="font-normal">
              Allow several choices
            </FieldLabel>
          </FieldBox>
          {field.multiple && (
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <OptionalNumber
                id={`${id}-min-items`}
                label="Pick at least"
                value={field.minItems}
                onChange={(minItems) => onChange({ ...field, minItems })}
              />
              <OptionalNumber
                id={`${id}-max-items`}
                label="Pick at most"
                value={field.maxItems}
                onChange={(maxItems) => onChange({ ...field, maxItems })}
              />
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <div className="text-sm font-medium">Options</div>
            {field.options.map((option, o) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: options are edited in place
              <div key={o} className="flex gap-2">
                <Input
                  aria-label={`Option ${o + 1} label`}
                  value={option.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    const auto = option.value === slug(option.label);
                    const next = {
                      label,
                      value: auto && label.trim() ? slug(label) : option.value,
                    };
                    onChange({
                      ...field,
                      options: field.options.map((x, k) => (k === o ? next : x)),
                    });
                  }}
                />
                <Input
                  aria-label={`Option ${o + 1} value`}
                  className="font-mono text-xs"
                  value={option.value}
                  onChange={(e) =>
                    onChange({
                      ...field,
                      options: field.options.map((x, k) =>
                        k === o ? { ...x, value: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete option ${o + 1}`}
                  disabled={disabled || field.options.length === 1}
                  onClick={() =>
                    onChange({ ...field, options: field.options.filter((_, k) => k !== o) })
                  }
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const n = field.options.length + 1;
                onChange({
                  ...field,
                  options: [...field.options, { value: `option_${n}`, label: `Option ${n}` }],
                });
              }}
            >
              <PlusIcon weight="bold" />
              Add option
            </Button>
            <Messages messages={at(errors, `${errorPath}.options`)} />
          </div>
        </>
      );
    case "group": {
      const taken = new Set(field.fields.map((f) => f.key));
      return (
        <>
          <OptionalNumber
            id={`${id}-min-items`}
            label="At least (items)"
            value={field.minItems}
            onChange={(minItems) => onChange({ ...field, minItems })}
          />
          <OptionalNumber
            id={`${id}-max-items`}
            label="At most (items)"
            value={field.maxItems}
            onChange={(maxItems) => onChange({ ...field, maxItems })}
          />
          <div className="space-y-2 sm:col-span-2">
            <div className="text-sm font-medium">Fields in each item</div>
            <p className="text-xs text-muted-foreground">
              Use them inside a repeating section or repeated table row as{" "}
              <code>{field.key}.child_key</code>. Groups can't contain groups.
            </p>
            {field.fields.map((child, c) => {
              const childPath = `${errorPath}.fields.${c}`;
              return (
                <FieldRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: order is identity
                  key={c}
                  field={child}
                  errorPath={childPath}
                  errors={errors}
                  open={openChild === c}
                  onToggle={() => setOpenChild(openChild === c ? null : c)}
                  disabled={disabled}
                  earlier={choicesOf(field.fields.slice(0, c))}
                  onChange={(next) => {
                    if (next.type === "group") return;
                    onChange({
                      ...field,
                      fields: field.fields.map((f, k) => (k === c ? next : f)),
                    });
                  }}
                  reorder={
                    <Reorder
                      label={child.label}
                      index={c}
                      count={field.fields.length}
                      onMove={(to) => {
                        onChange({ ...field, fields: move(field.fields, c, to) });
                        setOpenChild(to);
                      }}
                      onDelete={() => {
                        onChange({ ...field, fields: field.fields.filter((_, k) => k !== c) });
                        setOpenChild(null);
                      }}
                    />
                  }
                />
              );
            })}
            {!disabled && (
              <AddField
                types={scalarTypes}
                label="Add field to item"
                onAdd={(type) => {
                  const label = `New ${fieldTypeLabels[type].toLowerCase()}`;
                  const base: Field = {
                    type: "text",
                    key: uniqueKey(slug(label), taken),
                    label,
                    required: false,
                  };
                  onChange({ ...field, fields: [...field.fields, scalarOfType(base, type)] });
                  setOpenChild(field.fields.length);
                }}
              />
            )}
            <Messages messages={at(errors, `${errorPath}.fields`)} />
          </div>
        </>
      );
    }
    default:
      return null;
  }
}
