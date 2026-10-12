import {
  type CsvMapping,
  csvFieldTargets,
  defaultCsvMapping,
  MAX_BATCH_ROWS,
  parseCsv,
} from "@necodoc/shared";
import { WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { ErrorAlert } from "@/components/form";
import { BackLink, FaqLink, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { usePageCrumb } from "@/lib/breadcrumb";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs): a CSV upload in the
// app, one document per row, columns mapped to the template's fields.

const templatesQuery = queryOptions({
  queryKey: ["templates"],
  queryFn: async () => (await ok(api.templates.$get())).json(),
});

const versionQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id, "versions", "latest"],
    queryFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].$get({ param: { id, version: "latest" } }),
        )
      ).json(),
  });

export const Route = createFileRoute("/_app/batches/new")({
  component: NewBatch,
});

type Csv = { file: File; header: string[]; rows: number };

function NewBatch() {
  usePageCrumb("Run a batch");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const templates = useQuery(templatesQuery);
  const published = (templates.data ?? []).filter((t) => t.latestVersion !== null && !t.archivedAt);
  const [templateId, setTemplateId] = useState("");
  const version = useQuery({ ...versionQuery(templateId), enabled: templateId !== "" });
  const targets = version.data ? csvFieldTargets(version.data.sections) : [];
  const [csv, setCsv] = useState<Csv | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [filename, setFilename] = useState("");

  const readCsv = async (file: File | undefined) => {
    if (!file) return setCsv(null);
    const [header = [], ...rows] = parseCsv(await file.text());
    setCsv({ file, header, rows: rows.length });
  };

  // A new template or file starts from the columns named like fields.
  const sections = version.data?.sections;
  const [mappedFor, setMappedFor] = useState<{ sections: unknown; csv: Csv } | null>(null);
  if (sections && csv && (mappedFor?.sections !== sections || mappedFor.csv !== csv)) {
    setMappedFor({ sections, csv });
    setMapping(defaultCsvMapping(csv.header, sections));
  }

  const run = useMutation({
    mutationFn: async () => {
      if (!csv) throw new Error("Choose a CSV file");
      const res = await ok(
        api.templates[":id"].versions[":version"].batch.csv.$post({
          param: { id: templateId, version: "latest" },
          form: {
            file: csv.file,
            mapping: JSON.stringify(mapping),
            ...(filename.trim() ? { filename: filename.trim() } : {}),
          },
        }),
      );
      return res.json();
    },
    onSuccess: async (batch) => {
      await queryClient.invalidateQueries({ queryKey: ["batches"] });
      await navigate({ to: "/batches/$id", params: { id: batch.id } });
    },
  });

  const mapped = Object.keys(mapping).length;
  const tooMany = (csv?.rows ?? 0) > MAX_BATCH_ROWS;
  const empty = csv !== null && csv.rows === 0;
  // Top-level required fields only: a group's items are optional, and show-ifs can still
  // hide a field, so this is a heads-up rather than a block.
  const mappedPaths = new Set(Object.values(mapping));
  const missing = targets.filter(
    (t) => t.field.required && !t.path.includes(".") && !mappedPaths.has(t.path),
  );
  const blocker = !templateId
    ? "Choose a template"
    : !csv
      ? "Choose a CSV file"
      : !version.data
        ? "Loading the template…"
        : empty
          ? "The CSV has no rows"
          : tooMany
            ? `Over ${MAX_BATCH_ROWS.toLocaleString()} rows`
            : mapped === 0
              ? "Map at least one column"
              : null;

  return (
    <Page width="narrow">
      <PageHeader
        back={<BackLink to="/batches">Batches</BackLink>}
        title="Run a batch"
        description="One PDF per CSV row from the latest published version of a template. Rows with invalid data fail on their own; the rest still render."
        actions={<FaqLink feature="Batches" />}
      />
      <ErrorAlert error={templates.error ?? version.error} />

      <Step n={1} title="Template">
        <Field>
          <FieldLabel htmlFor="template" className="sr-only">
            Template
          </FieldLabel>
          <NativeSelect
            id="template"
            value={templateId}
            disabled={templates.isPending}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <NativeSelectOption value="">
              {templates.isPending ? "Loading templates…" : "Choose a published template"}
            </NativeSelectOption>
            {published.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name} (v{t.latestVersion})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            {templates.data && published.length === 0
              ? "No published templates yet. Publish a template to run batches from it."
              : version.data
                ? `Uses v${version.data.version}, the latest published version, with ${targets.length} ${targets.length === 1 ? "field" : "fields"}.`
                : "Only published templates can run batches."}
          </FieldDescription>
        </Field>
      </Step>

      <Step n={2} title="Rows">
        <Field>
          <FieldLabel htmlFor="csv">CSV file</FieldLabel>
          <Input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void readCsv(e.target.files?.[0])}
          />
          <FieldDescription>
            The first row is the header. Up to {MAX_BATCH_ROWS.toLocaleString()} rows and 20 MB.
            Columns named like a field key (or <code>group.key</code>) map themselves.
            Multiple-choice cells separate values with <code>;</code>.
          </FieldDescription>
        </Field>
        {csv && !empty && !tooMany && (
          <p className="text-sm text-ink-2" aria-live="polite">
            <span className="font-semibold text-ink">{csv.rows.toLocaleString()}</span>{" "}
            {csv.rows === 1 ? "row" : "rows"}, {csv.header.length}{" "}
            {csv.header.length === 1 ? "column" : "columns"}.
          </p>
        )}
        {(empty || tooMany) && (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle className="font-semibold">
              {empty ? "No rows to run" : "Too many rows"}
            </AlertTitle>
            <AlertDescription>
              {empty
                ? "The file has a header but no data rows."
                : `The file has ${csv?.rows.toLocaleString()} rows; a batch takes up to ${MAX_BATCH_ROWS.toLocaleString()}. Split it into smaller files.`}
            </AlertDescription>
          </Alert>
        )}
      </Step>

      <Step
        n={3}
        title="Map columns"
        description={
          csv && version.data
            ? `${mapped} of ${csv.header.length} columns fill a field. Unmapped columns are ignored.`
            : "Choose a template and a CSV file to match columns to fields."
        }
        flush={!!(csv && version.data)}
      >
        {csv && version.data && (
          <>
            {missing.length > 0 && (
              <div className="px-5 pb-4">
                <Alert>
                  <WarningIcon className="text-warn" />
                  <AlertTitle className="font-semibold">
                    {missing.length === 1
                      ? "A required field has no column"
                      : `${missing.length} required fields have no column`}
                  </AlertTitle>
                  <AlertDescription>
                    {missing.map((t) => t.field.label).join(", ")}. Rows fail without a value unless
                    the field is hidden for them.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-2/5">CSV column</TableHead>
                  <TableHead>Field</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csv.header.map((column) => (
                  <TableRow key={column}>
                    <TableCell className="max-w-48 truncate font-mono text-[13px]" title={column}>
                      {column}
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        aria-label={`Field for ${column}`}
                        className="w-full"
                        value={mapping[column] ?? ""}
                        onChange={(e) => {
                          const { [column]: _old, ...rest } = mapping;
                          setMapping(e.target.value ? { ...rest, [column]: e.target.value } : rest);
                        }}
                      >
                        <NativeSelectOption value="">Ignore this column</NativeSelectOption>
                        {targets.map((target) => (
                          <NativeSelectOption key={target.path} value={target.path}>
                            {target.field.label} ({target.path})
                          </NativeSelectOption>
                        ))}
                        {/* A later group item (items.1.qty), mapped from the column's own name. */}
                        {mapping[column] && !targets.some((t) => t.path === mapping[column]) && (
                          <NativeSelectOption value={mapping[column]}>
                            {mapping[column]}
                          </NativeSelectOption>
                        )}
                      </NativeSelect>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Step>

      <Step n={4} title="Output">
        <Field>
          <FieldLabel htmlFor="filename">File name</FieldLabel>
          <Input
            id="filename"
            placeholder={version.data?.name ?? "Template name"}
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
          <FieldDescription>
            Each PDF gets its row number appended. Leave blank to use the template name.
          </FieldDescription>
        </Field>
      </Step>

      <ErrorAlert error={run.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!!blocker || run.isPending} onClick={() => run.mutate()}>
          {run.isPending
            ? "Queueing…"
            : `Queue ${(csv?.rows ?? 0).toLocaleString()} ${csv?.rows === 1 ? "document" : "documents"}`}
        </Button>
        {blocker && <span className="text-sm text-ink-3">{blocker}</span>}
      </div>
    </Page>
  );
}

/** One numbered step of the form, as a card. `flush` lets a table run edge to edge. */
function Step({
  n,
  title,
  description,
  flush = false,
  children,
}: {
  n: number;
  title: string;
  description?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={flush ? "pb-0" : undefined} aria-labelledby={`step-${n}`} role="group">
      <CardHeader>
        <CardTitle id={`step-${n}`} className="flex items-center gap-2.5">
          <span
            className="grid size-7 place-items-center rounded-lg bg-tint text-[13px] text-brand-ink tabular-nums"
            aria-hidden
          >
            {n}
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className={flush ? "px-0" : "space-y-3"}>{children}</CardContent>}
    </Card>
  );
}
