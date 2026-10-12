import { type GenerationStatus, hasPermission, type SubmissionStatus } from "@necodoc/shared";
import { ChartBarIcon } from "@phosphor-icons/react";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  bucketDays,
  logDays,
  RangeControls,
  rangeSearchFields,
  toRange,
} from "@/components/analytics";
import {
  ChartCard,
  countsByBucket,
  criticalColor,
  formatCount,
  goodColor,
  InlineBar,
  otherColor,
  SimpleTable,
  StatTile,
  slot,
  TimeChart,
  timeTable,
} from "@/components/charts";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ok } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { formatMs, statusLabels } from "./generations/-generation-actions";

// Spec: docs/features/analytics-dashboards.md (My usage). Everyone with a role; the API scopes
// it to the signed-in user.

const searchSchema = z.object(rangeSearchFields);
type Search = z.infer<typeof searchSchema>;

const usageQuery = (search: Search) => {
  const query = toRange(search);
  return queryOptions({
    queryKey: ["analytics", "me", query],
    queryFn: async () => (await ok(api.analytics.me.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
};

const statusSeries = [
  { key: "success", label: statusLabels.success, color: goodColor },
  { key: "error", label: statusLabels.error, color: criticalColor },
  { key: "cancelled", label: statusLabels.cancelled, color: otherColor },
  { key: "queued", label: "Queued or running", color: slot(1) },
] as const;
type StatusKey = (typeof statusSeries)[number]["key"];
const statusKey = (status: GenerationStatus): StatusKey =>
  status === "running" ? "queued" : status;

const documentLabels = { draft: "Drafts", finished: "Finished" } satisfies Record<
  SubmissionStatus,
  string
>;

export const Route = createFileRoute("/_app/usage")({
  validateSearch: searchSchema,
  component: Usage,
});

function Usage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const result = useQuery(usageQuery(search));
  const range = toRange(search);
  const days = logDays(range.from, range.to);
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
  const finished = data ? data.totals.success + data.totals.errors : 0;
  // Templates nobody generated in the range stay in the CSV but not on screen.
  const usedTemplates = data?.templateUsage?.filter((t) => t.generations > 0) ?? [];
  const unusedTemplates = (data?.templateUsage?.length ?? 0) - usedTemplates.length;
  const canCreate = hasPermission(me.user.roles, { document: ["create"] });
  const editor =
    hasPermission(me.user.roles, { document: ["create"] }) ||
    hasPermission(me.user.roles, { document: ["edit"] });

  return (
    <Page>
      <PageHeader
        title="My usage"
        description={`What you generated and filled in${editor ? ", and how often your templates are used" : ""}.`}
        actions={
          <>
            <FaqLink feature="My usage" />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/generations" search={days} />}
            >
              Open my generations
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <RangeControls search={search} onChange={(next) => navigate({ search: next })} />
      </div>
      <ErrorAlert error={result.error} />

      {result.isPending && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["generations", "errors", "pages", "size"].map((key) => (
              <Skeleton key={key} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}

      {data && byStatus && (
        <>
          {data.totals.generations === 0 ? (
            <EmptyState
              icon={ChartBarIcon}
              title="No generations in this range"
              description="PDFs you generate, from a form, a batch or your API keys, show up here. Try a longer date range."
              action={
                canCreate && (
                  <Button nativeButton={false} render={<Link to="/documents/new" />}>
                    New document
                  </Button>
                )
              }
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Generations" value={formatCount(data.totals.generations)} />
                <StatTile
                  label="Errors"
                  value={formatCount(data.totals.errors)}
                  hint={
                    finished
                      ? `${((data.totals.errors / finished) * 100).toFixed(1)}% of finished`
                      : undefined
                  }
                />
                <StatTile label="Pages" value={formatCount(data.totals.pages)} />
                <StatTile label="Output size" value={formatBytes(data.totals.bytes)} />
              </div>

              <ChartCard
                title="My generations"
                description="Click a column to open those entries."
                fetching={fetching}
                table={timeTable(byStatus, true)}
                csv={{ filename: "my-generations", ...timeTable(byStatus, true) }}
              >
                <TimeChart
                  data={byStatus}
                  kind="stacked"
                  label="My generations over time by status"
                  onSelect={(t) =>
                    navigate({ to: "/generations", search: bucketDays(data.bucket, t) })
                  }
                />
              </ChartCard>
            </>
          )}

          <div
            className={cn("grid gap-4", data.totals.generations > 0 && "xl:grid-cols-[3fr_2fr]")}
          >
            {data.totals.generations > 0 && (
              <ChartCard
                title="Templates I generated"
                fetching={fetching}
                csv={{
                  filename: "my-templates-generated",
                  header: ["Template", "Generations", "Errors", "p95 total ms"],
                  rows: data.templates.map((t) => [t.name, t.generations, t.errors, t.p95TotalMs]),
                }}
              >
                <SimpleTable
                  header={["Template", "Generations", "Errors", "p95 total"]}
                  rows={data.templates.map((t) => [
                    <Link
                      key="link"
                      to="/generations"
                      search={{ templateId: t.templateId, ...days }}
                      className="hover:underline"
                    >
                      {t.name}
                    </Link>,
                    <InlineBar
                      key="bar"
                      value={t.generations}
                      max={data.templates[0]?.generations ?? 0}
                    />,
                    t.errors,
                    formatMs(t.p95TotalMs),
                  ])}
                />
              </ChartCard>
            )}
            <ChartCard
              title="My documents"
              description="Started in the range, and all time."
              fetching={fetching}
              csv={{
                filename: "my-documents",
                header: ["Status", "Source", "In range", "All time"],
                rows: data.documents.map((d) => [d.status, d.source, d.inRange, d.count]),
              }}
            >
              <SimpleTable
                header={["Documents", "In range", "All time"]}
                empty="No documents yet."
                rows={data.documents.map((d) => [
                  <Link key="link" to="/" className="hover:underline">
                    {documentLabels[d.status]}
                    {d.source === "share_link" ? " · from share links" : ""}
                  </Link>,
                  d.inRange,
                  d.count,
                ])}
              />
            </ChartCard>
          </div>

          {data.templateUsage && (
            <ChartCard
              title="Templates I created"
              description={
                unusedTemplates > 0
                  ? `Generated by anyone in the range. ${unusedTemplates} with no generations hidden; the CSV lists them.`
                  : "Generated by anyone in the range."
              }
              fetching={fetching}
              csv={{
                filename: "my-template-usage",
                header: ["Template", "Generations", "Errors", "Users"],
                rows: data.templateUsage.map((t) => [t.name, t.generations, t.errors, t.users]),
              }}
            >
              <SimpleTable
                header={["Template", "Generations", "Errors", "Users"]}
                empty={
                  data.templateUsage.length
                    ? "Nobody generated your templates in this range."
                    : "You haven't created any templates."
                }
                rows={usedTemplates.map((t) => [
                  <Link
                    key="link"
                    to="/templates/$id"
                    params={{ id: t.templateId }}
                    className="hover:underline"
                  >
                    {t.name}
                  </Link>,
                  <InlineBar
                    key="bar"
                    value={t.generations}
                    max={usedTemplates[0]?.generations ?? 0}
                  />,
                  t.errors,
                  t.users,
                ])}
              />
            </ChartCard>
          )}
        </>
      )}
    </Page>
  );
}
