import { orientationSchema, type PageOptions, pageSizeSchema } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SuggestButton } from "@/components/ai";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { themesQuery } from "@/lib/queries";
import type { DesignedDraftValues } from "./-draft";

// Spec: docs/features/document-templates.md (page setup, theme).

const SIDES = ["top", "right", "bottom", "left"] as const;

export function PagePanel({
  draft,
  onChange,
  editable,
  suggestDescription,
}: {
  draft: DesignedDraftValues;
  onChange: (changes: Partial<DesignedDraftValues>) => void;
  editable: boolean;
  /** Set when AI is on and the user can edit. */
  suggestDescription?: () => Promise<string>;
}) {
  const themes = useQuery(themesQuery);
  const setPage = (page: Partial<PageOptions>) => onChange({ page: { ...draft.page, ...page } });
  return (
    <fieldset disabled={!editable} className="space-y-6">
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="template-description">Description</FieldLabel>
          {suggestDescription && (
            <SuggestButton
              suggest={suggestDescription}
              onSuggested={(description) => onChange({ description })}
            />
          )}
        </div>
        <Textarea
          id="template-description"
          rows={2}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <FieldDescription>Shown in the template list.</FieldDescription>
      </Field>

      <FieldSet>
        <FieldLegend>Page</FieldLegend>
        <FieldGroup className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="page-size">Size</FieldLabel>
            <NativeSelect
              id="page-size"
              className="w-full"
              value={draft.page.size}
              onChange={(e) => {
                const size = pageSizeSchema.safeParse(e.target.value).data;
                if (size) setPage({ size });
              }}
            >
              {pageSizeSchema.options.map((size) => (
                <NativeSelectOption key={size} value={size}>
                  {size}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="page-orientation">Orientation</FieldLabel>
            <NativeSelect
              id="page-orientation"
              className="w-full"
              value={draft.page.orientation}
              onChange={(e) => {
                const orientation = orientationSchema.safeParse(e.target.value).data;
                if (orientation) setPage({ orientation });
              }}
            >
              {orientationSchema.options.map((o) => (
                <NativeSelectOption key={o} value={o}>
                  {o === "portrait" ? "Portrait" : "Landscape"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {SIDES.map((side) => (
            <Field key={side}>
              <FieldLabel htmlFor={`margin-${side}`}>
                {side[0]?.toUpperCase()}
                {side.slice(1)} margin (mm)
              </FieldLabel>
              <Input
                id={`margin-${side}`}
                type="number"
                min={0}
                max={200}
                step={1}
                value={draft.page.margins[side]}
                onChange={(e) => {
                  const mm = e.target.valueAsNumber;
                  if (mm >= 0 && mm <= 200)
                    setPage({ margins: { ...draft.page.margins, [side]: mm } });
                }}
              />
            </Field>
          ))}
        </FieldGroup>
        <FieldDescription>
          The header and footer sit inside the top and bottom margins; their heights are added to
          them.
        </FieldDescription>
      </FieldSet>

      <Field>
        <FieldLabel htmlFor="template-theme">Theme</FieldLabel>
        <NativeSelect
          id="template-theme"
          className="w-full"
          value={draft.themeId ?? ""}
          onChange={(e) => onChange({ themeId: e.target.value || null })}
        >
          <NativeSelectOption value="">No theme (browser defaults)</NativeSelectOption>
          {themes.data?.map((theme) => (
            <NativeSelectOption key={theme.id} value={theme.id}>
              {theme.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          Fonts, colours and table styles for the body and bands. Manage them on{" "}
          <Link to="/themes">Themes</Link>. Publishing freezes the theme as it is then.
        </FieldDescription>
      </Field>
    </fieldset>
  );
}
