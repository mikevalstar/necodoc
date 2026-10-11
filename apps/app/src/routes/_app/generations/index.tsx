import {
  type GenerationSort,
  type generationFilterSchema,
  generationSourceSchema,
  generationStatusSchema,
} from "@necodoc/shared";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { InferResponseType } from "hono/client";
import { DownloadIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  DataTable,
  type DataTableFeatures,
  DebouncedInput,
  dataTableSearchSchema,
} from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, generationPdfUrl, ok } from "@/lib/api";
import { authClient, unwrap } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { batchesQuery, templatesQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/utils";
import {
  DeleteGenerationDialog,
  formatMs,
  StatusBadge,
  sourceLabels,
  statusLabels,
  useRerun,
} from "./-generation-actions";

// Spec: docs/features/generation-log.md. The API filters, sorts and pages (the log runs to tens
// of thousands of rows) and scopes non-admins to their own entries.

const sortable = [
  "queuedAt",
  "startedAt",
  "finishedAt",
  "filename",
  "pageCount",
  "size",
  "totalMs",
  "queueWaitMs",
  "durationMs",
  "attempts",
] as const satisfies readonly GenerationSort[];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchSchema = dataTableSearchSchema(sortable, "queuedAt").extend({
  q: z.string().optional(),
  source: generationSourceSchema.optional(),
  status: generationStatusSchema.optional(),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  /** Inclusive days, YYYY-MM-DD in local time. */
  from: day.optional(),
  to: day.optional(),
  /** Seconds, end to end. */
  slowerThan: z.number().min(0).optional(),
});
type GenerationsSearch = z.infer<typeof searchSchema>;

/** The API filter for the URL's filters: whole local days become instants. */
function toFilter(search: GenerationsSearch) {
  const { q, source, status, userId, templateId, batchId, from, to, slowerThan } = search;
  return {
    q: q?.trim() || undefined,
    source,
    status,
    userId,
    templateId,
    batchId,
    from: from && dayjs(from).startOf("day").toISOString(),
    to: to && dayjs(to).endOf("day").toISOString(),
    // Query strings; the API coerces.
    minTotalMs: slowerThan === undefined ? undefined : String(Math.round(slowerThan * 1000)),
  } satisfies z.input<typeof generationFilterSchema>;
}

/** The CSV export of everything matching the filters (metadata only). */
function exportUrl(search: GenerationsSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toFilter(search))) {
    if (value !== undefined) params.set(key, value);
  }
  return `/api/generations/export.csv?${params}`;
}

function generationsQuery(search: GenerationsSearch) {
  // Visible columns aren't part of the request, so toggling one doesn't refetch.
  const query = {
    ...toFilter(search),
    sort: search.sort,
    order: search.order,
    limit: String(search.pageSize),
    offset: String((search.page - 1) * search.pageSize),
  };
  return queryOptions({
    queryKey: ["generations", "list", query],
    queryFn: async () => (await ok(api.generations.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
}

const usersQuery = queryOptions({
  queryKey: ["admin", "users", "all"],
  queryFn: () => unwrap(authClient.admin.listUsers({ query: { limit: 500, sortBy: "name" } })),
});

type Generation = InferResponseType<typeof api.generations.$get, 200>["items"][number];

const column = createColumnHelper<DataTableFeatures, Generation>();
const allColumns = column.columns([
  column.accessor("queuedAt", {
    header: "Queued",
    cell: ({ row }) => (
      <Link
        to="/generations/$id"
        params={{ id: row.original.id }}
        className="font-medium tabular-nums hover:underline"
      >
        {dayjs(row.original.queuedAt).format("YYYY-MM-DD HH:mm:ss")}
      </Link>
    ),
    enableHiding: false,
  }),
  column.accessor("startedAt", {
    header: "Started",
    cell: ({ getValue }) => <Timestamp value={getValue()} />,
    meta: { hiddenByDefault: true },
  }),
  column.accessor("finishedAt", {
    header: "Finished",
    cell: ({ getValue }) => <Timestamp value={getValue()} />,
    meta: { hiddenByDefault: true },
  }),
  column.accessor("status", {
    header: "Status",
    cell: ({ row: { original } }) => (
      <>
        <StatusBadge status={original.status} />
        {original.warnings.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {original.warnings.length} warning{original.warnings.length > 1 && "s"}
          </div>
        )}
      </>
    ),
  }),
  column.accessor("source", {
    header: "Source",
    cell: ({ getValue }) => sourceLabels[getValue()],
  }),
  column.accessor("userName", {
    header: "User",
    cell: ({ getValue }) => getValue() ?? "—",
  }),
  column.accessor("templateName", {
    header: "Template",
    cell: ({ row: { original } }) =>
      original.templateName ?? (original.templateId ? "Deleted template" : "—"),
    meta: { className: "max-w-48 truncate" },
  }),
  column.accessor("filename", {
    header: "File",
    cell: ({ getValue }) => <span title={getValue()}>{getValue()}</span>,
    meta: { className: "max-w-56 truncate" },
  }),
  column.accessor("pageCount", {
    header: "Pages",
    cell: ({ getValue }) => getValue() ?? "—",
    meta: { className: "text-right tabular-nums" },
  }),
  column.accessor("size", {
    header: "Size",
    cell: ({ getValue }) => {
      const size = getValue();
      return size === null ? "—" : formatBytes(size);
    },
    meta: { className: "text-right tabular-nums" },
  }),
  column.accessor("totalMs", {
    header: "Total",
    cell: ({ getValue }) => formatMs(getValue()),
    meta: { className: "text-right tabular-nums" },
  }),
  column.accessor("queueWaitMs", {
    header: "Queue wait",
    cell: ({ getValue }) => formatMs(getValue()),
    meta: { className: "text-right tabular-nums", hiddenByDefault: true },
  }),
  column.accessor("durationMs", {
    header: "Run time",
    cell: ({ getValue }) => formatMs(getValue()),
    meta: { className: "text-right tabular-nums", hiddenByDefault: true },
  }),
  column.accessor("workerId", {
    header: "Worker",
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() ?? "—"}</span>,
    meta: { hiddenByDefault: true },
  }),
  column.accessor("attempts", {
    header: "Attempts",
    meta: { className: "text-right tabular-nums", hiddenByDefault: true },
  }),
  column.accessor("batchId", {
    header: "Batch",
    cell: ({ row: { original } }) =>
      original.batchId ? (
        <Link to="/batches/$id" params={{ id: original.batchId }} className="hover:underline">
          Row {original.batchRow === null ? "?" : original.batchRow + 1}
        </Link>
      ) : (
        "—"
      ),
    meta: { hiddenByDefault: true },
  }),
]);
/** Non-admins only see their own entries, so a user column says nothing. */
const ownColumns = allColumns.filter(
  (def) => !("accessorKey" in def && def.accessorKey === "userName"),
);

function Timestamp({ value }: { value: string | null }) {
  return (
    <span className="tabular-nums">{value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—"}</span>
  );
}

export const Route = createFileRoute("/_app/generations/")({
  validateSearch: searchSchema,
  component: Generations,
});

type Dialog = { kind: "delete"; generation: { id: string; filename: string } } | { kind: "bulk" };

function Generations() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const isAdmin = me.user.roles.includes("admin");
  const generations = useQuery(generationsQuery(search));
  const users = useQuery({ ...usersQuery, enabled: isAdmin });
  const templates = useQuery(templatesQuery);
  const batches = useQuery(batchesQuery);
  const rerun = useRerun();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setDialog(null);

  const setSearch = (next: Partial<GenerationsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  /** Filters change the result set, so they go back to page 1. */
  const setFilter = (next: Partial<GenerationsSearch>) => setSearch({ ...next, page: 1 });
  const hasFilter = Object.values(toFilter(search)).some((value) => value !== undefined);
  const total = generations.data?.total ?? 0;

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{isAdmin ? "Generations" : "My generations"}</h1>
          <p className="text-sm text-muted-foreground">
            Every PDF rendered{isAdmin ? "" : " by you"}, with its input and output. Previews aren't
            logged.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={exportUrl(search)} className={buttonVariants({ variant: "outline" })}>
            <DownloadIcon />
            Export CSV
          </a>
          {isAdmin && (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={!hasFilter || total === 0}
              title={hasFilter ? undefined : "Pick at least one filter first"}
              onClick={() => setDialog({ kind: "bulk" })}
            >
              Delete matching…
            </Button>
          )}
        </div>
      </div>

      <ErrorAlert error={rerun.error} />
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <DataTable
        columns={isAdmin ? allColumns : ownColumns}
        rows={generations.data?.items}
        total={generations.data?.total}
        getRowId={(generation) => generation.id}
        state={search}
        onStateChange={setSearch}
        sortable={sortable}
        isFetching={generations.isPlaceholderData}
        error={generations.error}
        noun="generation"
        onRowClick={(generation) =>
          navigate({ to: "/generations/$id", params: { id: generation.id } })
        }
        rowActions={(generation) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={<Link to="/generations/$id" params={{ id: generation.id }} />}
              >
                Open
              </DropdownMenuItem>
              {generation.hasOutput && (
                <DropdownMenuItem
                  render={
                    <a href={generationPdfUrl(generation.id)} download={generation.filename} />
                  }
                >
                  Download PDF
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={rerun.isPending}
                onClick={() => rerun.mutate(generation.id)}
              >
                Re-run
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDialog({ kind: "delete", generation })}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        toolbar={
          <>
            <Field className="w-auto">
              <FieldLabel htmlFor="q">Search</FieldLabel>
              <DebouncedInput
                id="q"
                type="search"
                className="w-56"
                placeholder="File, template, error, id…"
                value={search.q ?? ""}
                onCommit={(q) => setFilter({ q: q.trim() || undefined })}
              />
            </Field>
            <FilterSelect
              label="Status"
              value={search.status}
              options={generationStatusSchema.options.map((value) => ({
                value,
                label: statusLabels[value],
              }))}
              onChange={(value) =>
                setFilter({ status: generationStatusSchema.safeParse(value).data })
              }
            />
            <FilterSelect
              label="Source"
              value={search.source}
              options={generationSourceSchema.options.map((value) => ({
                value,
                label: sourceLabels[value],
              }))}
              onChange={(value) =>
                setFilter({ source: generationSourceSchema.safeParse(value).data })
              }
            />
            {isAdmin && (
              <FilterSelect
                label="User"
                value={search.userId}
                options={(users.data?.users ?? []).map((user) => ({
                  value: user.id,
                  label: user.name,
                }))}
                onChange={(value) => setFilter({ userId: value || undefined })}
              />
            )}
            <FilterSelect
              label="Template"
              value={search.templateId}
              options={(templates.data ?? []).map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              onChange={(value) => setFilter({ templateId: z.uuid().safeParse(value).data })}
            />
            <FilterSelect
              label="Batch"
              value={search.batchId}
              options={(batches.data ?? []).map((batch) => ({
                value: batch.id,
                label: `${batch.templateName} · ${dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm")}`,
              }))}
              onChange={(value) => setFilter({ batchId: z.uuid().safeParse(value).data })}
            />
            <Field className="w-auto">
              <FieldLabel htmlFor="from">From</FieldLabel>
              <Input
                id="from"
                type="date"
                value={search.from ?? ""}
                onChange={(e) => setFilter({ from: e.target.value || undefined })}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="to">To</FieldLabel>
              <Input
                id="to"
                type="date"
                value={search.to ?? ""}
                onChange={(e) => setFilter({ to: e.target.value || undefined })}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="slowerThan">Slower than (s)</FieldLabel>
              <DebouncedInput
                id="slowerThan"
                type="number"
                min={0}
                step="any"
                className="w-28"
                placeholder="Any"
                value={search.slowerThan === undefined ? "" : String(search.slowerThan)}
                onCommit={(value) =>
                  setFilter({
                    slowerThan: z
                      .number()
                      .min(0)
                      .safeParse(Number(value) || undefined).data,
                  })
                }
              />
            </Field>
            {hasFilter && (
              <Button
                variant="ghost"
                onClick={() =>
                  navigate({
                    search: ({ sort, order, pageSize, columns }) => ({
                      sort,
                      order,
                      pageSize,
                      columns,
                    }),
                  })
                }
              >
                Clear filters
              </Button>
            )}
          </>
        }
      />

      {dialog?.kind === "delete" && (
        <DeleteGenerationDialog
          generation={dialog.generation}
          onClose={close}
          onDeleted={() => {
            close();
            setNotice(`Deleted ${dialog.generation.filename}.`);
          }}
        />
      )}
      {dialog?.kind === "bulk" && (
        <BulkDeleteDialog
          search={search}
          total={total}
          onClose={close}
          onDone={(deleted) => {
            close();
            setNotice(
              `Deleted ${deleted.toLocaleString()} ${deleted === 1 ? "generation" : "generations"}.`,
            );
          }}
        />
      )}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="max-w-48"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">Any</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

/** Admins only. The API refuses an empty filter, so the whole log can't go in one click. */
function BulkDeleteDialog({
  search,
  total,
  onClose,
  onDone,
}: {
  search: GenerationsSearch;
  total: number;
  onClose: () => void;
  onDone: (deleted: number) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => (await ok(api.generations.$delete({ query: toFilter(search) }))).json(),
    onSuccess: async ({ deleted }) => {
      await queryClient.invalidateQueries({ queryKey: ["generations"] });
      onDone(deleted);
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {total.toLocaleString()} {total === 1 ? "generation" : "generations"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every entry matching the current filters is deleted with its input and PDF, across all
            pages of results. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete {total.toLocaleString()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
