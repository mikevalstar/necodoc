import {
  type GenerationSort,
  type generationFilterSchema,
  generationSourceSchema,
  generationStatusSchema,
} from "@necodoc/shared";
import {
  DotsThreeIcon,
  DownloadSimpleIcon,
  FunnelSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
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
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { apiKeysQuery } from "@/components/api-keys";
import {
  activeFilter,
  DataTable,
  type DataTableFeatures,
  DebouncedInput,
  dataTableSearchSchema,
  FilterSelect,
} from "@/components/data-table";
import { DemoLock } from "@/components/demo-lock";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { SavedViews } from "@/components/saved-views";
import { TokenBar } from "@/components/token-bar";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, generationPdfUrl, ok } from "@/lib/api";
import { authClient, unwrap } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { batchesQuery, templatesQuery } from "@/lib/queries";
import { cn, formatBytes } from "@/lib/utils";
import {
  generationFiltersSearchSchema,
  parseFilters,
  serializeFilters,
  sinceInstant,
  suggest,
  type TokenLookups,
} from "./-filter-tokens";
import {
  DeleteGenerationDialog,
  formatMs,
  SignedLinkDialog,
  StatusBadge,
  sourceLabels,
  statusLabels,
  useRerun,
} from "./-generation-actions";
import { RenderTimeHistogram } from "./-render-time-histogram";

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

const searchSchema = dataTableSearchSchema(sortable, "queuedAt").extend(
  generationFiltersSearchSchema.shape,
);
type GenerationsSearch = z.infer<typeof searchSchema>;

/** Seconds → a ms query string (the API coerces). */
const msParam = (seconds: number | undefined) =>
  seconds === undefined ? undefined : String(Math.round(seconds * 1000));

/** The API filter for the URL's filters: whole local days and relative times become instants. */
function toFilter(search: GenerationsSearch) {
  const { q, source, status, userId, templateId, batchId, apiKeyId, from, to, since } = search;
  return {
    q: q?.trim() || undefined,
    source: source?.join(","),
    status: status?.join(","),
    userId,
    templateId,
    batchId,
    apiKeyId,
    from: since ? sinceInstant(since) : from && dayjs(from).startOf("day").toISOString(),
    to: to && dayjs(to).endOf("day").toISOString(),
    minTotalMs: msParam(search.slowerThan),
    maxTotalMs: msParam(search.fasterThan),
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

/** The histogram leaves out the time range (it shows it), so picking a bar doesn't refetch it. */
function renderTimesQuery(search: GenerationsSearch) {
  const { minTotalMs: _min, maxTotalMs: _max, ...query } = toFilter(search);
  return queryOptions({
    queryKey: ["generations", "render-times", query],
    queryFn: async () => (await ok(api.generations["render-times"].$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
}

const sinceOptions = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** One value shows as itself; several as a combined option the select can't otherwise name. */
function listSelect<T extends string>(values: T[] | undefined, labels: Record<T, string>) {
  if (!values?.length) return { value: undefined, extra: [] };
  if (values.length === 1) return { value: values[0], extra: [] };
  const value = values.join(",");
  return { value, extra: [{ value, label: values.map((v) => labels[v]).join(", ") }] };
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
        className="font-mono text-[13px] whitespace-nowrap hover:underline"
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
          <div className="mt-0.5 text-xs text-ink-3">
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
  column.accessor("apiKeyName", {
    header: "API key",
    cell: ({ row: { original } }) =>
      original.apiKeyName ?? (original.apiKeyId ? "Deleted key" : "—"),
    meta: { className: "max-w-40 truncate" },
  }),
  column.accessor("templateName", {
    header: "Template",
    cell: ({ row: { original } }) =>
      original.templateName ?? (original.templateId ? "Deleted template" : "—"),
    meta: { className: "max-w-48 truncate" },
  }),
  column.accessor("filename", {
    header: "File",
    cell: ({ row: { original } }) => (
      <>
        <div className="truncate font-semibold" title={original.filename}>
          {original.filename}
        </div>
        {original.error && (
          <div className="flex items-center gap-1 text-xs text-bad" title={original.error}>
            <WarningCircleIcon weight="bold" className="size-3.5 shrink-0" />
            <span className="truncate">{original.error}</span>
          </div>
        )}
      </>
    ),
    meta: { className: "max-w-56" },
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
    cell: ({ getValue }) => <span className="font-mono text-[13px]">{getValue() ?? "—"}</span>,
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
          Row {original.batchRow ?? "?"}
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
    <span className="font-mono text-[13px] whitespace-nowrap">
      {value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—"}
    </span>
  );
}

export const Route = createFileRoute("/_app/generations/")({
  validateSearch: searchSchema,
  component: Generations,
});

type Dialog =
  | { kind: "delete" | "link"; generation: { id: string; filename: string } }
  | { kind: "bulk" };

function Generations() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const isAdmin = me.user.roles.includes("admin");
  const generations = useQuery(generationsQuery(search));
  const users = useQuery({ ...usersQuery, enabled: isAdmin });
  const templates = useQuery(templatesQuery);
  const batches = useQuery(batchesQuery);
  const keys = useQuery(apiKeysQuery(isAdmin ? { all: "true" } : {}));
  const renderTimes = useQuery(renderTimesQuery(search));
  const rerun = useRerun();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  const setSearch = (next: Partial<GenerationsSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  /** Filters change the result set, so they go back to page 1. */
  const setFilter = (next: Partial<GenerationsSearch>) => setSearch({ ...next, page: 1 });
  const hasFilter = Object.values(toFilter(search)).some((value) => value !== undefined);
  const total = generations.data?.total ?? 0;
  /** The less-used filters sit behind "More filters", open whenever one is set. */
  const moreCount = [
    search.userId,
    search.from,
    search.to,
    search.batchId,
    search.apiKeyId,
    search.slowerThan,
  ].filter((value) => value !== undefined).length;
  const [moreOpen, setMoreOpen] = useState(moreCount > 0);
  const lookups: TokenLookups = {
    templates: templates.data ?? [],
    users: (users.data?.users ?? []).map(({ id, name, email }) => ({ id, name, email })),
    keys: keys.data ?? [],
    batches: (batches.data ?? []).map((batch) => ({
      id: batch.id,
      label: `${batch.templateName} · ${dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm")}`,
    })),
    isAdmin,
  };
  const status = listSelect(search.status, statusLabels);
  const source = listSelect(search.source, sourceLabels);

  return (
    <Page>
      <PageHeader
        title={isAdmin ? "Generations" : "My generations"}
        description={`Every PDF rendered${isAdmin ? "" : " by you"}, with its input and output. Previews aren't logged.`}
        actions={
          <>
            <FaqLink feature="Generation log" />
            {isAdmin && (
              // Would empty the log for every visitor of the public demo (ADR 0046).
              <DemoLock>
                <Button
                  variant="destructive"
                  disabled={!hasFilter || total === 0}
                  title={hasFilter ? undefined : "Pick at least one filter first"}
                  onClick={() => setDialog({ kind: "bulk" })}
                >
                  <TrashIcon />
                  Delete matching…
                </Button>
              </DemoLock>
            )}
            <a href={exportUrl(search)} className={buttonVariants({ variant: "outline" })}>
              <DownloadSimpleIcon />
              Export CSV
            </a>
          </>
        }
      />

      <ErrorAlert error={rerun.error} />

      <RenderTimeHistogram
        data={renderTimes.data}
        range={{ slowerThan: search.slowerThan, fasterThan: search.fasterThan }}
        onRange={setFilter}
      />

      <DataTable
        columns={isAdmin ? allColumns : ownColumns}
        rows={generations.data?.items}
        total={generations.data?.total}
        getRowId={(generation) => generation.id}
        state={search}
        onStateChange={setSearch}
        sortable={sortable}
        isFetching={generations.isPlaceholderData}
        actions={
          <SavedViews
            table="generations"
            search={search}
            isAdmin={isAdmin}
            onApply={(view) => {
              const parsed = searchSchema.safeParse(view);
              if (parsed.success) navigate({ search: parsed.data });
              else toast.error("That view no longer fits this page");
            }}
          />
        }
        error={generations.error}
        noun="generation"
        empty={
          hasFilter ? (
            "No generations match these filters."
          ) : (
            <>
              Nothing rendered yet. Fill in a{" "}
              <Link to="/documents/new" className="underline underline-offset-4">
                document
              </Link>
              , try the{" "}
              <Link to="/render" className="underline underline-offset-4">
                Render playground
              </Link>{" "}
              or call the{" "}
              <Link to="/developers" className="underline underline-offset-4">
                API
              </Link>
              ; every PDF lands here.
            </>
          )
        }
        onRowClick={(generation) =>
          navigate({ to: "/generations/$id", params: { id: generation.id } })
        }
        rowActions={(generation) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${generation.filename}`}
                />
              }
            >
              <DotsThreeIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={<Link to="/generations/$id" params={{ id: generation.id }} />}
              >
                Open
              </DropdownMenuItem>
              {generation.hasOutput && (
                <>
                  <DropdownMenuItem
                    render={
                      <a href={generationPdfUrl(generation.id)} download={generation.filename} />
                    }
                  >
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog({ kind: "link", generation })}>
                    Download link…
                  </DropdownMenuItem>
                </>
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
            <TokenBar
              label="Filter generations"
              className="basis-full"
              placeholder="Search, or filter: status:error source:api render:>2s since:7d template: key: batch:"
              value={serializeFilters(search, lookups)}
              suggest={(text, caret) => suggest(text, caret, lookups)}
              onApply={(text) => {
                const { filters, errors } = parseFilters(text, lookups);
                if (errors.length === 0) setFilter(filters);
                return errors;
              }}
            />
            <FilterSelect
              label="Status"
              any="Any status"
              value={status.value}
              options={[
                ...status.extra,
                ...generationStatusSchema.options.map((value) => ({
                  value,
                  label: statusLabels[value],
                })),
              ]}
              onChange={(value) =>
                setFilter({
                  status: z.array(generationStatusSchema).safeParse(value.split(",")).data,
                })
              }
            />
            <FilterSelect
              label="Source"
              any="Any source"
              value={source.value}
              options={[
                ...source.extra,
                ...generationSourceSchema.options.map((value) => ({
                  value,
                  label: sourceLabels[value],
                })),
              ]}
              onChange={(value) =>
                setFilter({
                  source: z.array(generationSourceSchema).safeParse(value.split(",")).data,
                })
              }
            />
            <FilterSelect
              label="Template"
              any="Any template"
              value={search.templateId}
              options={(templates.data ?? []).map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              onChange={(value) => setFilter({ templateId: z.uuid().safeParse(value).data })}
            />
            <FilterSelect
              label="Queued within"
              any="Any time"
              value={search.since}
              options={sinceOptions}
              // A relative start replaces a fixed one.
              onChange={(value) => setFilter({ since: value || undefined, from: undefined })}
            />
            <Button
              variant="outline"
              aria-expanded={moreOpen}
              aria-controls="more-filters"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <FunnelSimpleIcon />
              More filters
              {moreCount > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {moreCount}
                  <span className="sr-only"> set</span>
                </Badge>
              )}
            </Button>
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
                <XIcon weight="bold" />
                Clear
              </Button>
            )}
            {moreOpen && (
              // order-last puts this row under the density and Columns controls.
              <div id="more-filters" className="order-last flex basis-full flex-wrap gap-3">
                {isAdmin && (
                  <FilterSelect
                    label="User"
                    any="Any user"
                    value={search.userId}
                    options={(users.data?.users ?? []).map((user) => ({
                      value: user.id,
                      label: user.name,
                    }))}
                    onChange={(value) => setFilter({ userId: value || undefined })}
                  />
                )}
                {/* biome-ignore lint/a11y/useSemanticElements: a fieldset can't be a flex row in every browser */}
                <div role="group" aria-label="Queued between" className="flex items-center gap-1.5">
                  <span className="text-[13px] text-ink-3">Queued</span>
                  <Input
                    type="date"
                    aria-label="Queued from"
                    title="Queued from"
                    className={cn("w-36", search.from && activeFilter)}
                    value={search.from ?? ""}
                    onChange={(e) =>
                      setFilter({ from: e.target.value || undefined, since: undefined })
                    }
                  />
                  <span className="text-[13px] text-ink-3">to</span>
                  <Input
                    type="date"
                    aria-label="Queued to"
                    title="Queued to"
                    className={cn("w-36", search.to && activeFilter)}
                    value={search.to ?? ""}
                    onChange={(e) => setFilter({ to: e.target.value || undefined })}
                  />
                </div>
                <FilterSelect
                  label="Batch"
                  any="Any batch"
                  value={search.batchId}
                  options={(batches.data ?? []).map((batch) => ({
                    value: batch.id,
                    label: `${batch.templateName} · ${dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm")}`,
                  }))}
                  onChange={(value) => setFilter({ batchId: z.uuid().safeParse(value).data })}
                />
                <FilterSelect
                  label="API key"
                  any="Any API key"
                  value={search.apiKeyId}
                  options={(keys.data ?? []).map((key) => ({
                    value: key.id,
                    label: isAdmin ? `${key.name} (${key.ownerName})` : (key.name ?? key.id),
                  }))}
                  onChange={(value) => setFilter({ apiKeyId: value || undefined })}
                />
                <DebouncedInput
                  type="number"
                  aria-label="Slower than, in seconds"
                  min={0}
                  step="any"
                  className={cn("w-40", search.slowerThan !== undefined && activeFilter)}
                  placeholder="Slower than (s)"
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
              </div>
            )}
          </>
        }
      />

      {dialog?.kind === "delete" && (
        <DeleteGenerationDialog generation={dialog.generation} onClose={close} onDeleted={close} />
      )}
      {dialog?.kind === "link" && (
        <SignedLinkDialog generation={dialog.generation} onClose={close} />
      )}
      {dialog?.kind === "bulk" && (
        <BulkDeleteDialog
          search={search}
          total={total}
          onClose={close}
          onDone={(deleted) => {
            close();
            toast.success(
              `Deleted ${deleted.toLocaleString()} ${deleted === 1 ? "generation" : "generations"}`,
            );
          }}
        />
      )}
    </Page>
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
