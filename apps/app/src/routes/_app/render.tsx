import {
  bandSchema,
  marginsSchema,
  orientationSchema,
  pageSizeSchema,
  type RenderRequestInput,
} from "@necodoc/shared";
import { PlayIcon } from "@phosphor-icons/react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ErrorAlert, FieldShell, useAppForm, useFieldContext } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { PdfFrame, PdfTray } from "@/components/pdf-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { renderPdf, waitForGeneration } from "@/lib/api";
import { themesQuery } from "@/lib/queries";
import { cn, formatBytes } from "@/lib/utils";

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

const tabs = [
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "data", label: "Data" },
  { value: "page", label: "Page & theme" },
] as const;
type Tab = (typeof tabs)[number]["value"];

/** The tab a form field lives on, from its path (e.g. `page.margins.top`). */
const tabOf = (name: string): Tab | undefined => {
  const root = name.split(".")[0];
  if (root === "filename" || root === "themeId") return "page";
  return tabs.find((tab) => tab.value === root)?.value;
};

const formatMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

function RenderPlayground() {
  const themes = useQuery(themesQuery);
  // Timed from the click: what an API caller would wait, including the PDF download.
  const render = useMutation({
    mutationFn: async (request: RenderRequestInput) => {
      const startedAt = performance.now();
      const outcome = await renderPdf(request);
      return { outcome, startedAt, ms: performance.now() - startedAt };
    },
  });
  // Over the API's wait (ADR 0020) the render keeps going as a job: poll it, show it when done.
  const pendingId = render.data?.outcome.pending ? render.data.outcome.generationId : null;
  const startedAt = render.data?.startedAt ?? 0;
  const waited = useQuery({
    queryKey: ["generation-wait", pendingId],
    queryFn: pendingId
      ? async () => {
          const outcome = await waitForGeneration(pendingId);
          return { outcome, ms: performance.now() - startedAt };
        }
      : skipToken,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const done = [render.data, waited.data].find((d) => d && !d.outcome.pending);
  const result = done && !done.outcome.pending ? { ...done.outcome, ms: done.ms } : null;
  // Keep the last PDF up while the next one renders or if it fails.
  const [shown, setShown] = useState(result);
  if (result && result.pdf !== shown?.pdf) setShown(result);
  const busy = render.isPending || (pendingId !== null && !result && !waited.error);

  const form = useAppForm({
    defaultValues,
    validators: { onChange: playgroundSchema },
    onSubmit: ({ value }) => render.mutate(toRequest(value)),
  });

  const status = busy
    ? "Rendering…"
    : render.error || waited.error
      ? shown
        ? "Failed, showing the last PDF"
        : "Failed"
      : shown
        ? "Rendered"
        : "Not rendered yet";
  const toolbar = (
    <>
      <span role="status" className="inline-flex items-center gap-2 font-bold">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full bg-white ring-3 ring-white/25",
            busy && "animate-pulse",
          )}
        />
        {status}
      </span>
      {shown && (
        <span className="text-white/80 tabular-nums">
          {shown.pageCount} {shown.pageCount === 1 ? "page" : "pages"} ·{" "}
          {formatBytes(shown.pdf.size)} ·{" "}
          <span title="From pressing Render to the PDF arriving">{formatMs(shown.ms)}</span>
        </span>
      )}
      {shown && (
        <span className="ml-auto">
          {shown.generationId ? (
            <Link
              to="/generations/$id"
              params={{ id: shown.generationId }}
              className="font-mono text-xs text-white underline underline-offset-2"
              title={`Generation ${shown.generationId}`}
            >
              Generation {shown.generationId.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-white/80">Preview, not logged</span>
          )}
        </span>
      )}
    </>
  );

  return (
    <Page width="wide">
      <PageHeader
        title="Render playground"
        description="Turn HTML, Liquid and data into a PDF with the same renderer as templates and the API. Press ⌘/Ctrl+Enter in the editor to render."
        actions={
          <>
            <FaqLink feature="HTML to PDF rendering" />
            <div>
              <form.AppField name="preview">
                {(field) => <field.SwitchField label="Preview (not logged)" />}
              </form.AppField>
            </div>
            <Button
              type="submit"
              form="render-form"
              disabled={render.isPending}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              <PlayIcon weight="fill" />
              {render.isPending ? "Rendering…" : "Render"}
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card className="gap-0 py-0">
          <form
            id="render-form"
            aria-label="Render request"
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
            <Tabs defaultValue="html">
              <form.Subscribe
                selector={(state) =>
                  Object.entries(state.fieldMeta)
                    .filter(([, meta]) => meta?.isTouched && !meta.isValid)
                    .map(([name]) => tabOf(name))
                    .join(",")
                }
              >
                {(errorTabs) => (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-4">
                    <TabsList className="max-w-full overflow-x-auto">
                      {tabs.map((tab) => {
                        const invalid = errorTabs.split(",").includes(tab.value);
                        return (
                          <TabsTrigger key={tab.value} value={tab.value}>
                            {tab.label}
                            {invalid && (
                              <>
                                <span aria-hidden className="size-1.5 rounded-full bg-bad" />
                                <span className="sr-only">(has errors)</span>
                              </>
                            )}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                    {errorTabs && (
                      <p role="alert" className="basis-full text-sm text-bad">
                        Fix the highlighted fields on{" "}
                        {tabs
                          .filter((tab) => errorTabs.split(",").includes(tab.value))
                          .map((tab) => tab.label)
                          .join(", ")}
                        .
                      </p>
                    )}
                  </div>
                )}
              </form.Subscribe>
              {/* keepMounted keeps each tab's errors and scroll position while switching. */}
              <TabsContent value="html" keepMounted className="p-5">
                <form.AppField name="html">
                  {(field) => (
                    <field.TextareaField
                      label="HTML (Liquid)"
                      description="{{ value }} prints data, escaped; | raw opts out. Filters: date, number, currency, qrcode, barcode, asset_url. No JavaScript, no remote URLs."
                      mono
                      rows={24}
                    />
                  )}
                </form.AppField>
              </TabsContent>
              <TabsContent value="css" keepMounted className="p-5">
                <form.AppField name="css">
                  {(field) => (
                    <field.TextareaField
                      label="CSS"
                      description="Added after the theme."
                      mono
                      rows={24}
                    />
                  )}
                </form.AppField>
              </TabsContent>
              {(["header", "footer"] as const).map((name) => (
                <TabsContent key={name} value={name} keepMounted className="p-5">
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
              <TabsContent value="data" keepMounted className="p-5">
                <form.AppField name="data">
                  {(field) => (
                    <field.TextareaField
                      label="Data (JSON)"
                      description="The variables HTML, header and footer can use."
                      mono
                      rows={24}
                    />
                  )}
                </form.AppField>
              </TabsContent>
              <TabsContent value="page" keepMounted className="p-5">
                <FieldGroup>
                  <form.AppField name="themeId">
                    {(field) => (
                      <FieldShell label="Theme" description="Fonts, colours and base styles.">
                        {({ id }) => (
                          <NativeSelect
                            id={id}
                            className="w-full"
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
                  <div className="grid grid-cols-2 gap-4">
                    <form.AppField name="page.size">
                      {() => <OptionsField label="Size" options={pageSizeSchema.options} />}
                    </form.AppField>
                    <form.AppField name="page.orientation">
                      {() => (
                        <OptionsField label="Orientation" options={orientationSchema.options} />
                      )}
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
          </form>
        </Card>

        <div className="space-y-3 lg:sticky lg:top-4">
          <ErrorAlert error={render.error ?? waited.error} />
          {busy && pendingId && (
            <Alert>
              <AlertDescription>
                Still rendering. It'll appear in{" "}
                <Link to="/generations/$id" params={{ id: pendingId }} className="underline">
                  Generations
                </Link>{" "}
                when it's done, and here if you stay on this page.
              </AlertDescription>
            </Alert>
          )}
          {shown ? (
            <PdfFrame
              pdf={shown.pdf}
              title="Rendered PDF"
              toolbar={toolbar}
              className="h-[80svh]"
            />
          ) : (
            <PdfTray toolbar={toolbar}>
              <div className="grid h-[80svh] place-items-center p-6 text-center text-sm text-white/80">
                {busy ? "Rendering…" : "Press Render to see the PDF here."}
              </div>
            </PdfTray>
          )}
        </div>
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
