import {
  type BundledFont,
  bundledFonts,
  createThemeSchema,
  hasPermission,
  type RenderRequestInput,
  type Theme,
  type ThemeFont,
  themeInputSchema,
} from "@necodoc/shared";
import { useStore } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { z } from "zod";
import { ErrorAlert, FieldShell, useAppForm, useFieldContext } from "@/components/form";
import { PdfFrame, usePdfPreview } from "@/components/pdf-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { api, ok } from "@/lib/api";
import { assetsQuery, themesQuery } from "@/lib/queries";
import { DeleteThemeDialog, useDuplicateTheme } from "./-theme-actions";

// Spec: docs/features/document-themes.md
const themeQuery = (id: string) =>
  queryOptions({
    queryKey: ["themes", id],
    queryFn: async () => (await ok(api.themes[":id"].$get({ param: { id } }))).json(),
  });

export const Route = createFileRoute("/_app/themes/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(themeQuery(params.id)),
  component: ThemePage,
});

function ThemePage() {
  const { id } = Route.useParams();
  const theme = useSuspenseQuery(themeQuery(id)).data;
  return <ThemeEditor key={theme.id} theme={theme} />;
}

/** Shows off every setting: fonts, headings, links, a table, and a footer band. */
const sample = {
  html: `<h1>Service agreement</h1>
<p>This agreement is made on <strong>{{ "now" | date }}</strong> between <a href="#">Acme Corporation</a> and the client named below. It sets out the services, the fees and how either party may end it.</p>
<hr>
<h2>1. Services</h2>
<p>Acme will provide the services described in the schedule. Any change to the scope must be agreed in writing by both parties before work begins.</p>
<ul><li>Monthly reporting</li><li>Quarterly reviews</li><li>Support during business hours</li></ul>
<h2>2. Fees</h2>
<table>
  <thead><tr><th>Item</th><th>Quantity</th><th>Price</th></tr></thead>
  <tbody>
    <tr><td>Setup</td><td>1</td><td>{{ 1200 | currency }}</td></tr>
    <tr><td>Monthly service</td><td>12</td><td>{{ 450 | currency }}</td></tr>
    <tr><td>Training session</td><td>2</td><td>{{ 300 | currency }}</td></tr>
  </tbody>
</table>
<h3>2.1 Payment terms</h3>
<p>Invoices are due within 30 days. Late payments may incur interest at the statutory rate.</p>
<pre><code>Reference: ACME-2026-0042</code></pre>`,
  footer: {
    html: `<div style="display:flex;justify-content:space-between;padding:0 20mm;font-size:8pt;opacity:.7"><span>Acme Corporation</span><span>Page {{ page }} of {{ pages }}</span></div>`,
    height: 10,
  },
} satisfies RenderRequestInput;

type ThemeValues = z.input<typeof createThemeSchema>;

function ThemeEditor({ theme }: { theme: Theme }) {
  const { me } = Route.useRouteContext();
  const canCreate = hasPermission(me.user.roles, { document: ["create"] });
  const canEdit = hasPermission(me.user.roles, { document: ["edit"] }) && !theme.builtIn;
  const queryClient = useQueryClient();
  const duplicate = useDuplicateTheme();
  const [deleting, setDeleting] = useState(false);

  const save = useMutation({
    mutationFn: async (json: ThemeValues) =>
      (await ok(api.themes[":id"].$patch({ param: { id: theme.id }, json }))).json(),
    onSuccess: (saved) => {
      queryClient.setQueryData(themeQuery(theme.id).queryKey, saved);
      return queryClient.invalidateQueries({ queryKey: themesQuery.queryKey, exact: true });
    },
  });
  const defaultValues: ThemeValues = {
    name: theme.name,
    settings: theme.settings,
    css: theme.css,
  };
  const form = useAppForm({
    defaultValues,
    validators: { onChange: createThemeSchema },
    listeners: { onChange: () => save.reset() },
    onSubmit: ({ value }) => save.mutate(value),
  });

  const values = useStore(form.store, (state) => state.values);
  const request = useMemo(() => {
    const draft = themeInputSchema.safeParse(values);
    return draft.success ? { ...sample, themeDraft: draft.data } : null;
  }, [values]);
  const preview = usePdfPreview(request);

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 py-8">
      <Link
        to="/themes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Themes
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{theme.name}</h1>
        {theme.builtIn && <Badge variant="secondary">Built-in</Badge>}
        <div className="ml-auto flex gap-2">
          {canCreate && (
            <Button
              variant="outline"
              disabled={duplicate.isPending}
              onClick={() => duplicate.mutate(form.state.values)}
            >
              Duplicate
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setDeleting(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {!canEdit && (
        <Alert>
          <AlertDescription>
            {theme.builtIn
              ? "Built-in starters can't be edited. Duplicate this one to make your own."
              : "You can view this theme but not edit it."}
          </AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={duplicate.error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          {/* A disabled fieldset makes every control inside read-only in one place. */}
          <fieldset disabled={!canEdit} className="space-y-6">
            <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>

            <FieldSet>
              <FieldLegend>Body text</FieldLegend>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <form.AppField name="settings.font">
                    {() => <FontField label="Body font" />}
                  </form.AppField>
                </div>
                <form.AppField name="settings.fontSize">
                  {(field) => <field.NumberField label="Size (pt)" />}
                </form.AppField>
                <form.AppField name="settings.lineHeight">
                  {(field) => <field.NumberField label="Line height" step={0.05} />}
                </form.AppField>
                <form.AppField name="settings.textColor">
                  {(field) => <field.ColorField label="Text" />}
                </form.AppField>
                <form.AppField name="settings.linkColor">
                  {(field) => <field.ColorField label="Links" />}
                </form.AppField>
                <form.AppField name="settings.accentColor">
                  {(field) => <field.ColorField label="Accent (rules)" />}
                </form.AppField>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Headings</FieldLegend>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <form.AppField name="settings.headingFont">
                    {() => <FontField label="Heading font" />}
                  </form.AppField>
                </div>
                <form.AppField name="settings.headingColor">
                  {(field) => <field.ColorField label="Colour" />}
                </form.AppField>
                <form.AppField name="settings.h1Size">
                  {(field) => <field.NumberField label="H1 size (pt)" />}
                </form.AppField>
                <form.AppField name="settings.h2Size">
                  {(field) => <field.NumberField label="H2 size (pt)" />}
                </form.AppField>
                <form.AppField name="settings.h3Size">
                  {(field) => <field.NumberField label="H3 size (pt)" />}
                </form.AppField>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Tables</FieldLegend>
              <FieldGroup className="grid grid-cols-2 gap-4">
                <form.AppField name="settings.tableBorderColor">
                  {(field) => <field.ColorField label="Borders" />}
                </form.AppField>
                <form.AppField name="settings.tableHeaderBackground">
                  {(field) => <field.ColorField label="Header shading" />}
                </form.AppField>
                <form.AppField name="settings.tableCellPadding">
                  {(field) => <field.NumberField label="Cell padding (mm)" />}
                </form.AppField>
              </FieldGroup>
            </FieldSet>

            <form.AppField name="css">
              {(field) => (
                <field.TextareaField
                  label="Free CSS"
                  description="Added after the settings above, so it wins. Remote URLs don't load; use assets."
                  mono
                  rows={8}
                />
              )}
            </form.AppField>

            {canEdit && (
              <div className="flex items-center gap-3">
                <form.Subscribe selector={(state) => state.canSubmit}>
                  {(canSubmit) => (
                    <Button type="submit" disabled={!canSubmit || save.isPending}>
                      Save theme
                    </Button>
                  )}
                </form.Subscribe>
                {save.isSuccess && (
                  <span role="status" className="text-sm text-muted-foreground">
                    Saved.
                  </span>
                )}
              </div>
            )}
            <ErrorAlert error={save.error} />
          </fieldset>
        </form>

        <section className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Sample document</span>
            <span>
              {preview.isFetching
                ? "Rendering…"
                : request
                  ? "Up to date"
                  : "Fix the errors to preview"}
            </span>
          </div>
          <ErrorAlert error={preview.error} />
          {preview.data ? (
            <PdfFrame pdf={preview.data.pdf} title="Theme preview" className="h-[80svh]" />
          ) : (
            <div className="flex h-[80svh] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              Rendering preview…
            </div>
          )}
        </section>
      </div>

      {deleting && <DeleteThemeDialog theme={theme} onClose={() => setDeleting(false)} />}
    </main>
  );
}

const bundledFontIds = Object.keys(bundledFonts) as BundledFont[];
const isBundledFont = (value: string): value is BundledFont => value in bundledFonts;

/** Bundled fonts by id, uploaded font assets as `asset:<id>`. */
function FontField({ label }: { label: string }) {
  const field = useFieldContext<ThemeFont>();
  const fonts = useQuery(assetsQuery({ kind: "font" }));
  const value =
    typeof field.state.value === "string"
      ? field.state.value
      : `asset:${field.state.value.assetId}`;
  return (
    <FieldShell label={label}>
      {({ id, onBlur }) => (
        <NativeSelect
          id={id}
          className="w-full"
          value={value}
          onBlur={onBlur}
          onChange={(e) => {
            const next = e.target.value;
            field.handleChange(
              isBundledFont(next) ? next : { assetId: next.replace(/^asset:/, "") },
            );
          }}
        >
          <NativeSelectOptGroup label="Bundled">
            {bundledFontIds.map((font) => (
              <NativeSelectOption key={font} value={font}>
                {bundledFonts[font].family}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
          <NativeSelectOptGroup label="Uploaded">
            {fonts.data?.map((asset) => (
              <NativeSelectOption key={asset.id} value={`asset:${asset.id}`}>
                {asset.name}
              </NativeSelectOption>
            ))}
            {/* A deleted font still shows, so the select doesn't silently change it. */}
            {value.startsWith("asset:") &&
              !fonts.data?.some((asset) => `asset:${asset.id}` === value) && (
                <NativeSelectOption value={value}>Missing font</NativeSelectOption>
              )}
          </NativeSelectOptGroup>
        </NativeSelect>
      )}
    </FieldShell>
  );
}
