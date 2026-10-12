import {
  bandSchema,
  marginsSchema,
  orientationSchema,
  pageSizeSchema,
  type RenderRequestInput,
} from "@necodoc/shared";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ErrorAlert, FieldShell, useAppForm, useFieldContext } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { PdfFrame } from "@/components/pdf-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { renderPdf, waitForGeneration } from "@/lib/api";
import { themesQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/utils";

// The HTML playground: the render request of docs/features/html-to-pdf-api.md, field by field.
export const Route = createFileRoute("/_app/render")({
  component: RenderPlayground,
});

const bandValuesSchema = z.object({
  enabled: z.boolean(),
  html: z.string(),
  height: bandSchema.shape.height,
  differentFirstPage: z.boolean(),
  firstPageHtml: z.string(),
});

/** The data tab is JSON text; it must parse to an object. */
const jsonObjectSchema = z
  .string()
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not valid JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.unknown(), { error: "Enter a JSON object, e.g. {}" }));

const playgroundSchema = z.object({
  html: z.string().min(1, "Enter some HTML"),
  css: z.string(),
  themeId: z.string(),
  header: bandValuesSchema,
  footer: bandValuesSchema,
  data: jsonObjectSchema,
  page: z.object({ size: pageSizeSchema, orientation: orientationSchema, margins: marginsSchema }),
  filename: z.string().max(200),
  preview: z.boolean(),
});
type PlaygroundValues = z.input<typeof playgroundSchema>;

const band = ({
  enabled,
  html,
  height,
  differentFirstPage,
  firstPageHtml,
}: PlaygroundValues["header"]) =>
  enabled
    ? { html, height, firstPageHtml: differentFirstPage ? firstPageHtml : undefined }
    : undefined;

function toRequest(values: PlaygroundValues): RenderRequestInput {
  const parsed = playgroundSchema.parse(values);
  return {
    html: parsed.html,
    css: parsed.css || undefined,
    themeId: parsed.themeId || undefined,
    header: band(parsed.header),
    footer: band(parsed.footer),
    page: parsed.page,
    data: parsed.data,
    filename: parsed.filename.trim() || undefined,
    preview: parsed.preview,
  };
}

/** Three pages with a letterhead on page 1, a slim header after, and page numbers. */
const defaultValues: PlaygroundValues = {
  html: `<h1>Quote for {{ customer.name }}</h1>
<p>Prepared {{ "now" | date: "MMMM D, YYYY" }}. Valid for 30 days.</p>
{% for section in sections %}
<section style="break-before: {% if forloop.first %}auto{% else %}page{% endif %}">
  <h2>{{ forloop.index }}. {{ section.title }}</h2>
  <p>{{ section.body }}</p>
  <table>
    <thead><tr><th>Item</th><th>Amount</th></tr></thead>
    <tbody>
    {% for line in section.lines %}
      <tr><td>{{ line.item }}</td><td>{{ line.amount | currency }}</td></tr>
    {% endfor %}
    </tbody>
  </table>
</section>
{% endfor %}`,
  css: "section p { max-width: 40em; }",
  themeId: "",
  header: {
    enabled: true,
    height: 15,
    html: `<div style="padding: 6mm 20mm 0; font-size: 8pt; opacity: .7">{{ customer.name }} · Quote</div>`,
    differentFirstPage: true,
    firstPageHtml: `<div style="padding: 5mm 20mm 0; font-size: 14pt; font-weight: 700">Acme Corporation</div>`,
  },
  footer: {
    enabled: true,
    height: 12,
    html: `<div style="padding: 3mm 20mm 0; font-size: 8pt; text-align: right">Page {{ page }} of {{ pages }}</div>`,
    differentFirstPage: false,
    firstPageHtml: "",
  },
  data: JSON.stringify(
    {
      customer: { name: "Globex Ltd" },
      sections: ["Discovery", "Build", "Support"].map((title, i) => ({
        title,
        body: `What ${title.toLowerCase()} covers, and what it doesn't.`,
        lines: [
          { item: `${title} workshop`, amount: 1200 * (i + 1) },
          { item: `${title} report`, amount: 450 },
        ],
      })),
    },
    null,
    2,
  ),
  page: {
    size: "Letter",
    orientation: "portrait",
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
  },
  filename: "Quote",
  preview: false,
};

function RenderPlayground() {
  const themes = useQuery(themesQuery);
  const render = useMutation({ mutationFn: renderPdf });
  // Over the API's wait (ADR 0020) the render keeps going as a job: poll it, show it when done.
  const pendingId = render.data?.pending ? render.data.generationId : null;
  const waited = useQuery({
    queryKey: ["generation-wait", pendingId],
    queryFn: pendingId ? () => waitForGeneration(pendingId) : skipToken,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const done = [render.data, waited.data].find((o) => o && !o.pending);
  const result = done && !done.pending ? done : null;
  const form = useAppForm({
    defaultValues,
    validators: { onChange: playgroundSchema },
    onSubmit: ({ value }) => render.mutate(toRequest(value)),
  });

  return (
    <Page>
      <PageHeader
        title="Render playground"
        description="Turn HTML, Liquid and data into a PDF with the same renderer as templates and the API. Press ⌘/Ctrl+Enter to render."
        actions={<FaqLink feature="HTML to PDF rendering" />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              form.handleSubmit();
            }
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <form.AppField name="themeId">
              {(field) => (
                <FieldShell label="Theme">
                  {({ id }) => (
                    <NativeSelect
                      id={id}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    >
                      <NativeSelectOption value="">No theme</NativeSelectOption>
                      {themes.data?.map((theme) => (
                        <NativeSelectOption key={theme.id} value={theme.id}>
                          {theme.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FieldShell>
              )}
            </form.AppField>
            <div className="pb-1.5">
              <form.AppField name="preview">
                {(field) => <field.SwitchField label="Preview (not logged)" />}
              </form.AppField>
            </div>
            <Button type="submit" className="ml-auto" disabled={render.isPending}>
              {render.isPending ? "Rendering…" : "Render"}
            </Button>
          </div>

          <Tabs defaultValue="html">
            <TabsList>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="css">CSS</TabsTrigger>
              <TabsTrigger value="header">Header</TabsTrigger>
              <TabsTrigger value="footer">Footer</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
              <TabsTrigger value="page">Page</TabsTrigger>
            </TabsList>
            {/* keepMounted keeps each tab's errors and scroll position while switching. */}
            <TabsContent value="html" keepMounted>
              <form.AppField name="html">
                {(field) => (
                  <field.TextareaField
                    label="HTML (Liquid)"
                    description="{{ value }} prints data, escaped; | raw opts out. Filters: date, number, currency, qrcode, barcode, asset_url. No JavaScript, no remote URLs."
                    mono
                    rows={22}
                  />
                )}
              </form.AppField>
            </TabsContent>
            <TabsContent value="css" keepMounted>
              <form.AppField name="css">
                {(field) => (
                  <field.TextareaField
                    label="CSS"
                    description="Added after the theme."
                    mono
                    rows={22}
                  />
                )}
              </form.AppField>
            </TabsContent>
            {(["header", "footer"] as const).map((name) => (
              <TabsContent key={name} value={name} keepMounted>
                <FieldGroup>
                  <form.AppField name={`${name}.enabled`}>
                    {(field) => <field.SwitchField label={`Use a ${name}`} />}
                  </form.AppField>
                  <form.Subscribe selector={(state) => state.values[name]}>
                    {(values) =>
                      values.enabled && (
                        <>
                          <form.AppField name={`${name}.height`}>
                            {(field) => <field.NumberField label="Height (mm)" step={1} />}
                          </form.AppField>
                          <form.AppField name={`${name}.html`}>
                            {(field) => (
                              <field.TextareaField
                                label="HTML (Liquid)"
                                description="Same theme and data as the body, plus {{ page }} and {{ pages }}. Content taller than the height is cut off."
                                mono
                                rows={8}
                              />
                            )}
                          </form.AppField>
                          <form.AppField name={`${name}.differentFirstPage`}>
                            {(field) => <field.SwitchField label="Different first page" />}
                          </form.AppField>
                          {values.differentFirstPage && (
                            <form.AppField name={`${name}.firstPageHtml`}>
                              {(field) => (
                                <field.TextareaField label="First page HTML" mono rows={8} />
                              )}
                            </form.AppField>
                          )}
                        </>
                      )
                    }
                  </form.Subscribe>
                </FieldGroup>
              </TabsContent>
            ))}
            <TabsContent value="data" keepMounted>
              <form.AppField name="data">
                {(field) => (
                  <field.TextareaField
                    label="Data (JSON)"
                    description="The variables HTML, header and footer can use."
                    mono
                    rows={22}
                  />
                )}
              </form.AppField>
            </TabsContent>
            <TabsContent value="page" keepMounted>
              <FieldGroup>
                <div className="grid grid-cols-2 gap-4">
                  <form.AppField name="page.size">
                    {() => <OptionsField label="Size" options={pageSizeSchema.options} />}
                  </form.AppField>
                  <form.AppField name="page.orientation">
                    {() => <OptionsField label="Orientation" options={orientationSchema.options} />}
                  </form.AppField>
                  {(["top", "right", "bottom", "left"] as const).map((side) => (
                    <form.AppField key={side} name={`page.margins.${side}`}>
                      {(field) => <field.NumberField label={`Margin ${side} (mm)`} step={1} />}
                    </form.AppField>
                  ))}
                </div>
                <FieldDescription>
                  Header and footer heights are added to the top and bottom margins.
                </FieldDescription>
                <form.AppField name="filename">
                  {(field) => <field.TextField label="Filename" placeholder="document" />}
                </form.AppField>
              </FieldGroup>
            </TabsContent>
          </Tabs>
          <form.Subscribe selector={(state) => state.errors}>
            {(errors) =>
              errors.length > 0 && (
                <p className="text-sm text-destructive">
                  Fix the highlighted fields, in every tab.
                </p>
              )
            }
          </form.Subscribe>
        </form>

        <section className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <ErrorAlert error={render.error ?? waited.error} />
          {pendingId && !result && (
            <Alert role="status">
              <AlertDescription>
                Still rendering. It'll appear in{" "}
                <Link to="/generations/$id" params={{ id: pendingId }} className="underline">
                  Generations
                </Link>{" "}
                when it's done, and here if you stay on this page.
              </AlertDescription>
            </Alert>
          )}
          {result ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {result.pageCount} {result.pageCount === 1 ? "page" : "pages"} ·{" "}
                  {formatBytes(result.pdf.size)}
                </span>
                {result.generationId ? (
                  <Link
                    to="/generations/$id"
                    params={{ id: result.generationId }}
                    className="font-mono text-xs underline"
                  >
                    Generation {result.generationId}
                  </Link>
                ) : (
                  <span>Preview, not logged</span>
                )}
              </div>
              <PdfFrame pdf={result.pdf} title="Rendered PDF" className="h-[80svh]" />
            </>
          ) : (
            <div className="flex h-[80svh] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {render.isPending || pendingId ? "Rendering…" : "Press Render to see the PDF here."}
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}

function OptionsField<T extends string>({
  label,
  options,
}: {
  label: string;
  options: readonly T[];
}) {
  const field = useFieldContext<T>();
  return (
    <FieldShell label={label}>
      {({ id, onBlur }) => (
        <NativeSelect
          id={id}
          className="w-full"
          value={field.state.value}
          onBlur={onBlur}
          onChange={(e) => {
            const next = options.find((option) => option === e.target.value);
            if (next) field.handleChange(next);
          }}
        >
          {options.map((option) => (
            <NativeSelectOption key={option} value={option} className="capitalize">
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FieldShell>
  );
}
