import {
  type CsvMapping,
  csvFieldTargets,
  defaultCsvMapping,
  MAX_BATCH_ROWS,
  parseCsv,
} from "@necodoc/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
import { Button } from "@/components/ui/button";
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

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 py-8">
      <Link
        to="/batches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Batches
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Run a batch</h1>
        <p className="text-sm text-muted-foreground">
          One PDF per CSV row from the latest published version of a template. Rows with invalid
          data fail on their own; the rest still render.
        </p>
      </div>
      <ErrorAlert error={templates.error ?? version.error ?? run.error} />

      <Field>
        <FieldLabel htmlFor="template">Template</FieldLabel>
        <NativeSelect
          id="template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <NativeSelectOption value="">Choose a published template</NativeSelectOption>
          {published.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.name} (v{t.latestVersion})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor="csv">CSV file</FieldLabel>
        <Input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void readCsv(e.target.files?.[0])}
        />
        <FieldDescription>
          First row is the header. Up to {MAX_BATCH_ROWS.toLocaleString()} rows and 20 MB. Columns
          named like a field key (or <code>group.key</code>) map themselves. Multiple-choice cells
          separate values with <code>;</code>.
        </FieldDescription>
      </Field>

      {csv && version.data && (
        <section className="space-y-2">
          <h2 className="font-medium">
            Columns ({mapped} of {csv.header.length} mapped, {csv.rows} rows)
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CSV column</TableHead>
                <TableHead>Field</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {csv.header.map((column) => (
                <TableRow key={column}>
                  <TableCell className="font-mono text-xs">{column}</TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Field for ${column}`}
                      value={mapping[column] ?? ""}
                      onChange={(e) => {
                        const { [column]: _old, ...rest } = mapping;
                        setMapping(e.target.value ? { ...rest, [column]: e.target.value } : rest);
                      }}
                    >
                      <NativeSelectOption value="">Ignore</NativeSelectOption>
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
        </section>
      )}

      <Field>
        <FieldLabel htmlFor="filename">File name</FieldLabel>
        <Input
          id="filename"
          placeholder={version.data?.name ?? "Template name"}
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
        <FieldDescription>Each PDF gets its row number appended.</FieldDescription>
      </Field>

      <Button
        disabled={!csv || !version.data || !mapped || tooMany || run.isPending}
        onClick={() => run.mutate()}
      >
        {run.isPending ? "Queueing…" : `Queue ${csv?.rows ?? 0} documents`}
      </Button>
    </main>
  );
}
