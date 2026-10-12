import {
  type FieldSection,
  type MergeFilter,
  mergeFilterSchema,
  type ScalarField,
} from "@necodoc/shared";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";
import { enclosingRepeat, pageTokens, pathLabel, scalarChoices, useEditorFields } from "./context";

// ADR 0016: an inline atom that prints a field value, compiled to {{ path | filter }}. Attrs
// mirror mergeFieldNodeSchema in packages/shared/src/template-doc.ts.

export type MergeFieldAttrs = { field: string; filter: MergeFilter | null };

const parseFilter = (raw: string | null): MergeFilter | null => {
  if (!raw) return null;
  try {
    return mergeFilterSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
};

const readAttrs = (attrs: Record<string, unknown>): MergeFieldAttrs => ({
  field: typeof attrs.field === "string" ? attrs.field : "",
  filter: mergeFilterSchema.safeParse(attrs.filter).data ?? null,
});

export const MergeField = Node.create({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      field: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-merge-field") ?? "",
        renderHTML: (attrs) => ({ "data-merge-field": attrs.field }),
      },
      filter: {
        default: null,
        parseHTML: (el) => parseFilter(el.getAttribute("data-filter")),
        renderHTML: (attrs) =>
          attrs.filter ? { "data-filter": JSON.stringify(attrs.filter) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-merge-field]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), `{{ ${node.attrs.field} }}`];
  },

  renderText({ node }) {
    return `{{ ${node.attrs.field} }}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MergeFieldView, { as: "span" });
  },
});

/** dayjs's localized formats: the renderer prints them in the document language (ADR 0040). */
const LOCALIZED_DATE_FORMATS: Record<string, string> = {
  LL: "Long, in the document language",
  L: "Short, in the document language",
  LLLL: "With weekday, in the document language",
};

const DATE_FORMATS = [
  ...Object.keys(LOCALIZED_DATE_FORMATS),
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "D MMMM YYYY",
  "YYYY-MM-DD",
  "MM/DD/YYYY",
  "DD/MM/YYYY",
];

const filterLabels: Record<MergeFilter["name"], string> = {
  date: "Date",
  number: "Number",
  currency: "Currency",
  upcase: "UPPERCASE",
  downcase: "lowercase",
  capitalize: "Capitalise",
  lines: "Keep line breaks",
};

/** A filter with its first sensible argument. */
const newFilter = (name: MergeFilter["name"]): MergeFilter => {
  switch (name) {
    case "date":
      return { name, format: "LL" };
    case "number":
      return { name, decimals: 2 };
    case "currency":
      return { name, currency: "USD" };
    default:
      return { name };
  }
};

/** What a new merge field on this type prints through by default. */
export function suggestedFilter(field: ScalarField | undefined): MergeFilter | null {
  if (field?.type === "date") return newFilter("date");
  if (field?.type === "long_text") return newFilter("lines");
  return null;
}

function filterSummary(filter: MergeFilter | null) {
  if (!filter) return "";
  switch (filter.name) {
    case "date":
      return filter.format;
    case "number":
      return `0.${"0".repeat(filter.decimals)}`.replace(/\.$/, "");
    case "currency":
      return filter.currency;
    default:
      return filterLabels[filter.name];
  }
}

/** A merge field target: a field, or a page token (no field) in bands. */
export type MergeChoice = { path: string; label: string; field?: ScalarField };

/** The fields a merge field may print here: scalars, the repeat's children, page tokens in bands. */
export function valueChoices(
  sections: readonly FieldSection[],
  repeat: string | null,
  band: boolean,
): MergeChoice[] {
  const choices: MergeChoice[] = scalarChoices(sections, repeat);
  return band ? [...choices, ...pageTokens] : choices;
}

/** Field and filter pickers, shared by the insert popover and a chip's edit popover. */
export function MergeFieldForm({
  value,
  onChange,
  choices,
}: {
  value: MergeFieldAttrs;
  onChange: (value: MergeFieldAttrs) => void;
  choices: readonly MergeChoice[];
}) {
  const known = choices.some((c) => c.path === value.field);
  const { filter } = value;
  return (
    <div className="space-y-3">
      <Field>
        <FieldLabel htmlFor="merge-field">Field</FieldLabel>
        <NativeSelect
          id="merge-field"
          className="w-full"
          value={value.field}
          onChange={(e) => {
            const choice = choices.find((c) => c.path === e.target.value);
            if (choice) onChange({ field: choice.path, filter: suggestedFilter(choice.field) });
          }}
        >
          {!known && (
            <NativeSelectOption value={value.field}>
              {value.field ? `Missing: ${value.field}` : "Pick a field"}
            </NativeSelectOption>
          )}
          {choices.map((c) => (
            <NativeSelectOption key={c.path} value={c.path}>
              {c.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="merge-filter">Format</FieldLabel>
        <NativeSelect
          id="merge-filter"
          className="w-full"
          value={filter?.name ?? ""}
          onChange={(e) => {
            const name = mergeFilterSchema.options
              .map((o) => o.shape.name.value)
              .find((n) => n === e.target.value);
            onChange({ ...value, filter: name ? newFilter(name) : null });
          }}
        >
          <NativeSelectOption value="">As entered</NativeSelectOption>
          {Object.entries(filterLabels).map(([name, label]) => (
            <NativeSelectOption key={name} value={name}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {filter?.name === "date" && (
        <Field>
          <FieldLabel htmlFor="merge-date-format">Date format</FieldLabel>
          <NativeSelect
            id="merge-date-format"
            className="w-full"
            value={DATE_FORMATS.includes(filter.format) ? filter.format : ""}
            onChange={(e) =>
              onChange({ ...value, filter: { ...filter, format: e.target.value || filter.format } })
            }
          >
            {DATE_FORMATS.map((format) => (
              <NativeSelectOption key={format} value={format}>
                {LOCALIZED_DATE_FORMATS[format] ?? dayjs("2026-01-15").format(format)}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="">Custom</NativeSelectOption>
          </NativeSelect>
          <Input
            aria-label="Custom date format"
            className="font-mono text-xs"
            value={filter.format}
            maxLength={50}
            onChange={(e) =>
              e.target.value &&
              onChange({ ...value, filter: { ...filter, format: e.target.value } })
            }
          />
        </Field>
      )}
      {filter?.name === "number" && (
        <Field>
          <FieldLabel htmlFor="merge-decimals">Decimal places</FieldLabel>
          <Input
            id="merge-decimals"
            type="number"
            min={0}
            max={10}
            value={filter.decimals}
            onChange={(e) => {
              const decimals = Math.round(e.target.valueAsNumber);
              if (decimals >= 0 && decimals <= 10)
                onChange({ ...value, filter: { ...filter, decimals } });
            }}
          />
        </Field>
      )}
      {filter?.name === "currency" && (
        <Field>
          <FieldLabel htmlFor="merge-currency">Currency code</FieldLabel>
          <Input
            id="merge-currency"
            className="font-mono uppercase"
            maxLength={3}
            defaultValue={filter.currency}
            onChange={(e) => {
              const currency = e.target.value.toUpperCase();
              if (/^[A-Z]{3}$/.test(currency))
                onChange({ ...value, filter: { ...filter, currency } });
            }}
          />
        </Field>
      )}
    </div>
  );
}

function MergeFieldView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
  selected,
}: ReactNodeViewProps) {
  const { sections, band } = useEditorFields();
  const [open, setOpen] = useState(false);
  const attrs = readAttrs(node.attrs);
  const pos = getPos();
  const repeat = typeof pos === "number" ? enclosingRepeat(editor.state.doc.resolve(pos)) : null;
  const choices = valueChoices(sections, repeat, band);
  const label = pathLabel(sections, attrs.field);
  const fits = choices.some((c) => c.path === attrs.field);
  const summary = filterSummary(attrs.filter);
  return (
    <NodeViewWrapper as="span" className="mx-px">
      <Popover open={open && editor.isEditable} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<span />}
          nativeButton={false}
          title={fits ? `{{ ${attrs.field} }}` : `"${attrs.field}" can't be used here`}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-[0.85em] leading-tight font-medium",
            fits
              ? "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200"
              : "border-destructive/50 bg-destructive/10 text-destructive",
            selected && "ring-2 ring-ring",
          )}
        >
          {label ?? attrs.field ?? "Field"}
          {summary && <span className="font-normal opacity-70">· {summary}</span>}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <MergeFieldForm value={attrs} onChange={updateAttributes} choices={choices} />
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-destructive"
            onClick={() => {
              setOpen(false);
              deleteNode();
            }}
          >
            Remove field
          </Button>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}
