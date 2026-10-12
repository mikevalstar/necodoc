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
import { CopyIcon, InfoIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import type { z } from "zod";
import { HistoryPanel } from "@/components/audit";
import { CodeEditor } from "@/components/code-editor";
import { ErrorAlert, FieldShell, useAppForm, useFieldContext } from "@/components/form";
import { BackLink, FaqLink, Page, PageHeader } from "@/components/page";
import { PdfFrame, PdfTray, usePdfPreview } from "@/components/pdf-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { api, ok, previewPdf } from "@/lib/api";
import { assetsQuery, themesQuery } from "@/lib/queries";
import { useSaveShortcut } from "@/lib/save-shortcut";
import { cn } from "@/lib/utils";
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
    onSubmit: ({ value }) =>
      save.mutate(value, {
        // The saved values become the new baseline, unless they were edited during the save.
        onSuccess: () => form.state.values === value && form.reset(value),
      }),
  });

  useSaveShortcut(canEdit && !save.isPending, form.handleSubmit);
  const values = useStore(form.store, (state) => state.values);
  const unsaved = useStore(form.store, (state) => !state.isDefaultValue);
  const request = useMemo(() => {
    const draft = themeInputSchema.safeParse(values);
    return draft.success ? { ...sample, themeDraft: draft.data } : null;
  }, [values]);
  const preview = usePdfPreview(request, previewPdf);

  const previewHeight = "h-[60svh] xl:h-[calc(100svh-9rem)] xl:min-h-[32rem]";
  const previewToolbar = (
    <>
      <span className="inline-flex items-center gap-2 font-bold">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full bg-white ring-3 ring-white/25",
            preview.isFetching && "animate-pulse",
          )}
        />
        Sample document
      </span>
      <span role="status" className="ml-auto text-white/80">
        {!request
          ? "Fix the highlighted settings to update"
          : preview.isFetching
            ? "Rendering…"
            : "Up to date"}
      </span>
    </>
  );

  return (
    <Page width="wide">
      <PageHeader
        back={<BackLink to="/themes">Themes</BackLink>}
        title={theme.name}
        actions={
          <>
            <FaqLink feature="Document themes" />
            {canEdit && (
              <Button variant="destructive" onClick={() => setDeleting(true)}>
                Delete…
              </Button>
            )}
            {canCreate && (
              <Button
                variant={canEdit ? "outline" : "default"}
                disabled={duplicate.isPending}
                onClick={() => duplicate.mutate(form.state.values)}
              >
                <CopyIcon />
                Duplicate
              </Button>
            )}
            {canEdit && (
              <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                  <Button
                    type="submit"
                    form="theme-form"
                    title="Save (⌘S)"
                    disabled={!canSubmit || !unsaved || save.isPending}
                  >
                    {save.isPending ? "Saving…" : "Save theme"}
                  </Button>
                )}
              </form.Subscribe>
            )}
          </>
        }
      >
        {theme.builtIn && <Badge variant="secondary">Built-in starter</Badge>}
        {canEdit && (
          <span role="status">
            {unsaved ? (
              <Badge variant="warn" dot>
                Unsaved changes
              </Badge>
            ) : (
              save.isSuccess && (
                <Badge variant="ok" dot>
                  Saved
                </Badge>
              )
            )}
          </span>
        )}
      </PageHeader>

      {!canEdit && (
        <Alert>
          <InfoIcon />
          <AlertDescription>
            {theme.builtIn
              ? canCreate
                ? "Built-in starters can't be edited. Duplicate this one to make your own."
                : "Built-in starters can't be edited."
              : "You can view this theme but not edit it."}
          </AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={duplicate.error ?? save.error} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <section
          aria-label="Theme preview"
          className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:order-2 xl:self-start"
        >
          <ErrorAlert error={preview.error} />
          {preview.data ? (
            <PdfFrame
              pdf={preview.data.pdf}
              title="Sample document with this theme"
              toolbar={previewToolbar}
              className={previewHeight}
            />
          ) : (
            <PdfTray toolbar={previewToolbar}>
              <div className={cn("grid place-items-center text-sm text-white/80", previewHeight)}>
                {preview.error ? "The preview couldn't render." : "Rendering preview…"}
              </div>
            </PdfTray>
          )}
        </section>

        <form
          id="theme-form"
          className="xl:order-1"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          {/* A disabled fieldset makes every control inside read-only in one place. */}
          <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
            <Card size="sm">
              <CardContent>
                <form.AppField name="name">
                  {(field) => <field.TextField label="Name" />}
                </form.AppField>
              </CardContent>
            </Card>

            <SettingsCard legend="Body text">
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
            </SettingsCard>

            <SettingsCard legend="Headings">
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
            </SettingsCard>

            <SettingsCard legend="Tables">
              <form.AppField name="settings.tableBorderColor">
                {(field) => <field.ColorField label="Borders" />}
              </form.AppField>
              <form.AppField name="settings.tableHeaderBackground">
                {(field) => <field.ColorField label="Header shading" />}
              </form.AppField>
              <form.AppField name="settings.tableCellPadding">
                {(field) => <field.NumberField label="Cell padding (mm)" />}
              </form.AppField>
            </SettingsCard>

            <Card size="sm">
              <CardContent>
                <form.AppField name="css">
                  {(field) => (
                    <Field>
                      <FieldLabel className="font-heading text-[15px] font-bold">
                        Free CSS
                      </FieldLabel>
                      <CodeEditor
                        label="Free CSS"
                        language="css"
                        readOnly={!canEdit}
                        value={field.state.value ?? ""}
                        onChange={field.handleChange}
                        placeholder={"blockquote { border-left: 2pt solid #aa3300; }"}
                        className="[&_.cm-editor]:min-h-48"
                      />
                      <FieldDescription>
                        Added after the settings above, so it wins. Remote URLs and @import don't
                        load; use assets.
                      </FieldDescription>
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.AppField>
              </CardContent>
            </Card>
          </fieldset>
        </form>
      </div>

      {deleting && <DeleteThemeDialog theme={theme} onClose={() => setDeleting(false)} />}
      <HistoryPanel targetType="theme" targetId={theme.id} />
    </Page>
  );
}

/** One group of settings, as a card titled by its legend. */
function SettingsCard({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent>
        <FieldSet>
          <FieldLegend className="mb-3 font-heading text-[15px] font-bold">{legend}</FieldLegend>
          <FieldGroup className="grid grid-cols-2 gap-4">{children}</FieldGroup>
        </FieldSet>
      </CardContent>
    </Card>
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
