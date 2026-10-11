import {
  type GenerationSource,
  type GenerationStatus,
  generationSourceSchema,
} from "@necodoc/shared";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  AnalyticsHeader,
  bucketDays,
  logDays,
  RangeControls,
  rangeSearchFields,
  toRange,
} from "@/components/analytics";
import { apiKeysQuery } from "@/components/api-keys";
import {
  ChartCard,
  countsByBucket,
  criticalColor,
  fieldsByBucket,
  formatCount,
  goodColor,
  InlineBar,
  otherColor,
  type SeriesDef,
  SimpleTable,
  StatTile,
  slot,
  TimeChart,
  timeTable,
} from "@/components/charts";
import { FilterSelect } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { Button } from "@/components/ui/button";
import { api, ok } from "@/lib/api";
import { authClient, unwrap } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/utils";
import { formatMs, sourceLabels, statusLabels } from "../../generations/-generation-actions";

// Spec: docs/features/analytics-dashboards.md (Documents). Filters scope every chart and table;
// rows link into the generation log with the same filters.

const searchSchema = z.object({
  ...rangeSearchFields,
  source: generationSourceSchema.optional(),
  templateId: z.uuid().optional(),
  userId: z.string().optional(),
  apiKeyId: z.string().optional(),
});
type Search = z.infer<typeof searchSchema>;

const documentsQuery = (search: Search) => {
  const { range: _, from: __, to: ___, ...filters } = search;
  const query = { ...toRange(search), ...filters };
  return queryOptions({
    queryKey: ["analytics", "documents", query],
    queryFn: async () => (await ok(api.analytics.documents.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
};

const usersQuery = queryOptions({
  queryKey: ["admin", "users", "all"],
  queryFn: () => unwrap(authClient.admin.listUsers({ query: { limit: 500, sortBy: "name" } })),
});

/** Status is state: success and error take the status colours; the rest recede. */
const statusSeries = [
  { key: "success", label: statusLabels.success, color: goodColor },
  { key: "error", label: statusLabels.error, color: criticalColor },
  { key: "cancelled", label: statusLabels.cancelled, color: otherColor },
  { key: "queued", label: "Queued or running", color: slot(1) },
] as const satisfies readonly SeriesDef<string>[];
type StatusKey = (typeof statusSeries)[number]["key"];
const statusKey = (status: GenerationStatus): StatusKey =>
  status === "running" ? "queued" : status;

/** Fixed slot per source, so filtering never repaints one. */
const sourceSeries = (
  [
    ["api", 1],
    ["batch", 2],
    ["app", 3],
    ["share_link", 4],
    ["rerun", 5],
    ["combine", 6],
  ] as const
).map(([key, n]) => ({
  key,
  label: sourceLabels[key],
  color: slot(n),
})) satisfies SeriesDef<GenerationSource>[];

const percentileSeries = (prefix: "queue" | "run") =>
  [
    { key: `${prefix}P50`, label: "p50", color: slot(1) },
    { key: `${prefix}P95`, label: "p95", color: slot(2) },
  ] as const;

export const Route = createFileRoute("/_app/admin/analytics/")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: DocumentAnalytics,
});

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function DocumentAnalytics() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const result = useQuery(documentsQuery(search));
  const templates = useQuery(templatesQuery);
  const users = useQuery(usersQuery);
  const keys = useQuery(apiKeysQuery({ all: "true" }));
  const setSearch = (next: Partial<Search>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });
  const range = toRange(search);
  const { range: _, from: __, to: ___, ...filters } = search;
  const hasFilter = Object.values(filters).some((value) => value !== undefined);
  /** The generation log, filtered like this page, over some days. */
  const logSearch = (days: { from: string; to: string }) => ({ ...filters, ...days });
  const rangeDays = logDays(range.from, range.to);
  const openLog = (days: { from: string; to: string }) =>
    navigate({ to: "/generations", search: logSearch(days) });

  const data = result.data;
  const fetching = result.isPlaceholderData;
  const byStatus =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      statusSeries,
      data.byStatus,
      (row) => statusKey(row.status),
      (row) => row.count,
    );
  const bySource =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      sourceSeries,
      data.bySource,
      (row) => row.source,
      (row) => row.count,
    );
  const queueWait =
    data && fieldsByBucket(data.bucket, data.buckets, percentileSeries("queue"), data.timings);
  const runTime =
    data && fieldsByBucket(data.bucket, data.buckets, percentileSeries("run"), data.timings);
  const finished = data ? data.totals.success + data.totals.errors : 0;

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 py-8">
      <AnalyticsHeader current="documents" />

      <div className="flex flex-wrap items-end gap-3">
        <RangeControls
          search={search}
          onChange={(next) => navigate({ search: { ...filters, ...next } })}
        />
        <FilterSelect
          label="Source"
          value={search.source}
          options={generationSourceSchema.options.map((value) => ({
            value,
            label: sourceLabels[value],
          }))}
          onChange={(value) => setSearch({ source: generationSourceSchema.safeParse(value).data })}
        />
        <FilterSelect
          label="Template"
          value={search.templateId}
          options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(value) => setSearch({ templateId: value || undefined })}
        />
        <FilterSelect
          label="User"
          value={search.userId}
          options={(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
          onChange={(value) => setSearch({ userId: value || undefined })}
        />
        <FilterSelect
          label="API key"
          value={search.apiKeyId}
          options={(keys.data ?? []).map((k) => ({
            value: k.id,
            label: k.name ?? k.start ?? k.id,
          }))}
          onChange={(value) => setSearch({ apiKeyId: value || undefined })}
        />
        {hasFilter && (
          <Button
            variant="ghost"
            onClick={() =>
              navigate({ search: { range: search.range, from: search.from, to: search.to } })
            }
          >
            Clear filters
          </Button>
        )}
        <Link
          to="/generations"
          search={logSearch(rangeDays)}
          className="ml-auto self-center text-sm text-muted-foreground hover:underline"
        >
          Open in the generation log
        </Link>
      </div>
      <ErrorAlert error={result.error} />

      {data && byStatus && bySource && queueWait && runTime && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Generations" value={formatCount(data.totals.generations)} />
            <StatTile
              label="Error rate"
              value={finished ? percent(data.totals.errors / finished) : "—"}
              hint={`${data.totals.errors.toLocaleString()} errors of ${finished.toLocaleString()} finished`}
            />
            <StatTile label="Pages" value={formatCount(data.totals.pages)} />
            <StatTile label="Output size" value={formatBytes(data.totals.bytes)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Generations by status"
              description="Click a column to open those entries in the generation log."
              fetching={fetching}
              table={timeTable(byStatus, true)}
              csv={{ filename: "generations-by-status", ...timeTable(byStatus, true) }}
            >
              <TimeChart
                data={byStatus}
                kind="stacked"
                label="Generations over time by status"
                onSelect={(t) => openLog(bucketDays(data.bucket, t))}
              />
            </ChartCard>
            <ChartCard
              title="Generations by source"
              fetching={fetching}
              table={timeTable(bySource, true)}
              csv={{ filename: "generations-by-source", ...timeTable(bySource, true) }}
            >
              <TimeChart
                data={bySource}
                kind="stacked"
                label="Generations over time by source"
                onSelect={(t) => openLog(bucketDays(data.bucket, t))}
              />
            </ChartCard>
            <ChartCard
              title="Queue wait"
              description="Queued to started, finished renders."
              fetching={fetching}
              table={timeTable(queueWait, false)}
              csv={{ filename: "queue-wait-ms", ...timeTable(queueWait, false) }}
            >
              <TimeChart
                data={queueWait}
                kind="line"
                format={formatMs}
                label="Queue wait p50 and p95 over time"
              />
            </ChartCard>
            <ChartCard
              title="Run time"
              description="Started to finished on the worker."
              fetching={fetching}
              table={timeTable(runTime, false)}
              csv={{ filename: "run-time-ms", ...timeTable(runTime, false) }}
            >
              <TimeChart
                data={runTime}
                kind="line"
                format={formatMs}
                label="Run time p50 and p95 over time"
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RankedCard
              title="Top templates"
              filename="top-templates"
              header={["Template", "Generations", "Errors", "p95 total"]}
              rows={data.templates.map((row) => ({
                key: row.templateId,
                cells: [row.name, row.generations, row.errors, formatMs(row.p95TotalMs)],
                bar: row.generations,
                link: { templateId: row.templateId },
              }))}
              logSearch={logSearch(rangeDays)}
              fetching={fetching}
            />
            <RankedCard
              title="Top users"
              filename="top-users"
              header={["User", "Generations", "Errors"]}
              rows={data.users.map((row) => ({
                key: row.userId,
                cells: [row.name, row.generations, row.errors],
                bar: row.generations,
                link: { userId: row.userId },
              }))}
              logSearch={logSearch(rangeDays)}
              fetching={fetching}
            />
            <RankedCard
              title="Top API keys"
              filename="top-api-keys"
              header={["Key", "Generations", "Errors"]}
              rows={data.keys.map((row) => ({
                key: row.apiKeyId,
                cells: [row.name ?? row.apiKeyId, row.generations, row.errors],
                bar: row.generations,
                link: { apiKeyId: row.apiKeyId },
              }))}
              logSearch={logSearch(rangeDays)}
              fetching={fetching}
            />
            <RankedCard
              title="Top errors"
              description="First line of the message, exact matches."
              filename="top-errors"
              header={["Error", "Count", "Last seen"]}
              rows={data.errors.map((row) => ({
                key: row.message,
                cells: [row.message, row.count, row.lastAt ? dayjs(row.lastAt).fromNow() : "—"],
                bar: row.count,
                link: { status: "error", q: row.message.slice(0, 200) },
              }))}
              logSearch={logSearch(rangeDays)}
              fetching={fetching}
            />
          </div>

          <ChartCard
            title="Batches"
            description="The largest batches with rows in the range."
            fetching={fetching}
            csv={{
              filename: "batches",
              header: [
                "Batch",
                "Template",
                "Version",
                "Rows",
                "Of total",
                "Errors",
                "Started",
                "Finished",
                "Rows per minute",
              ],
              rows: data.batches.map((b) => [
                b.batchId,
                b.templateName,
                b.version,
                b.rows,
                b.total,
                b.errors,
                b.startedAt,
                b.finishedAt,
                b.rowsPerMinute,
              ]),
            }}
          >
            <SimpleTable
              header={["Template", "Rows", "Errors", "Duration", "Rows / min"]}
              rows={data.batches.map((b) => [
                <Link
                  key="link"
                  to="/batches/$id"
                  params={{ id: b.batchId }}
                  className="hover:underline"
                >
                  {b.templateName} v{b.version}
                </Link>,
                `${b.rows.toLocaleString()} / ${b.total.toLocaleString()}`,
                b.errors,
                b.startedAt && b.finishedAt ? dayjs(b.startedAt).to(b.finishedAt, true) : "—",
                b.rowsPerMinute === null ? "—" : Math.round(b.rowsPerMinute),
              ])}
            />
          </ChartCard>

          <ChartCard
            title="Share links"
            description="Responses in the range; views and conversion (finished responses over page views) are lifetime."
            fetching={fetching}
            csv={{
              filename: "share-links",
              header: [
                "Link",
                "Template",
                "Owner",
                "Responses in range",
                "Views",
                "Finished responses",
                "Conversion",
              ],
              rows: data.shareLinks.map((l) => [
                l.label,
                l.templateName,
                l.ownerName,
                l.responses,
                l.views,
                l.lifetimeResponses,
                l.conversion,
              ]),
            }}
          >
            <SimpleTable
              header={["Link", "Responses", "Views", "Conversion"]}
              rows={data.shareLinks.map((l) => [
                <Link
                  key="link"
                  to="/share-links/$id"
                  params={{ id: l.id }}
                  className="hover:underline"
                >
                  {l.label} <span className="text-muted-foreground">· {l.templateName}</span>
                </Link>,
                l.responses,
                l.views,
                l.conversion === null ? "—" : percent(l.conversion),
              ])}
            />
          </ChartCard>
        </>
      )}
    </main>
  );
}

type LogSearch = Omit<Search, "range" | "from" | "to"> & { from: string; to: string };
/** What a ranked row narrows the generation log to. */
type RowLink = Partial<{
  templateId: string;
  userId: string;
  apiKeyId: string;
  status: "error";
  q: string;
}>;

/** A ranked list with a bar per row; each row opens the generation log narrowed to it. */
function RankedCard({
  title,
  description,
  filename,
  header,
  rows,
  logSearch,
  fetching,
}: {
  title: string;
  description?: string;
  filename: string;
  header: readonly string[];
  rows: { key: string; cells: readonly (string | number)[]; bar: number; link: RowLink }[];
  logSearch: LogSearch;
  fetching: boolean;
}) {
  const max = Math.max(0, ...rows.map((row) => row.bar));
  return (
    <ChartCard
      title={title}
      description={description}
      fetching={fetching}
      csv={{ filename, header, rows: rows.map((row) => row.cells) }}
    >
      <SimpleTable
        header={header}
        rows={rows.map(({ key, cells: [name, value, ...rest], bar, link }) => [
          <Link
            key={key}
            to="/generations"
            search={{ ...logSearch, ...link }}
            className="hover:underline"
            title={String(name)}
          >
            {name}
          </Link>,
          <InlineBar
            key="bar"
            value={bar}
            max={max}
            label={typeof value === "number" ? value.toLocaleString() : value}
          />,
          ...rest,
        ])}
      />
    </ChartCard>
  );
}
