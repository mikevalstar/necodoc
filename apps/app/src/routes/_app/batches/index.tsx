import { PlusIcon, StackIcon } from "@phosphor-icons/react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dayjs } from "@/lib/date";
import { batchesQuery } from "@/lib/queries";
import { BatchProgress, BatchStatusBadge } from "./-batch-status";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). The API scopes
// non-admins to their own batches.
const pollingBatchesQuery = queryOptions({
  ...batchesQuery,
  refetchInterval: (query) =>
    query.state.data?.some((batch) => batch.status === "running") ? 3000 : false,
});

export const Route = createFileRoute("/_app/batches/")({
  component: Batches,
});

function Batches() {
  const { me } = Route.useRouteContext();
  const isAdmin = me.user.roles.includes("admin");
  const batches = useQuery(pollingBatchesQuery);
  const running = batches.data?.filter((batch) => batch.status === "running").length ?? 0;
  const runBatch = (
    <Link to="/batches/new" className={buttonVariants()}>
      <PlusIcon weight="bold" />
      Run batch
    </Link>
  );
  return (
    <Page>
      <PageHeader
        title="Batches"
        description="Many PDFs from one published template, one per CSV or JSON row. Batch rows queue behind interactive renders."
        actions={
          <>
            <FaqLink feature="Batches" />
            {runBatch}
          </>
        }
      />
      <ErrorAlert error={batches.error} />
      {batches.isPending && <ListSkeleton />}
      {batches.data?.length === 0 && (
        <EmptyState
          icon={StackIcon}
          title="No batches yet"
          description="Upload a CSV with one row per document and get a PDF for each, plus a ZIP or one combined packet."
          action={runBatch}
        />
      )}
      {!!batches.data?.length && (
        <Card className="gap-0 py-0">
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <p className="text-sm text-ink-3" aria-live="polite">
              {batches.data.length.toLocaleString()}{" "}
              {batches.data.length === 1 ? "batch" : "batches"}
              {running > 0 && `, ${running} running`}
            </p>
            <DensityToggle />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-1/3 min-w-44">Progress</TableHead>
                <TableHead className="hidden lg:table-cell">Started</TableHead>
                {isAdmin && <TableHead className="hidden lg:table-cell">User</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.data.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="max-w-64">
                    <Link
                      to="/batches/$id"
                      params={{ id: batch.id }}
                      className="block truncate font-semibold hover:underline"
                      title={batch.templateName}
                    >
                      {batch.templateName} <span className="text-ink-3">v{batch.version}</span>
                    </Link>
                    <div className="font-mono text-xs text-ink-3 lg:hidden">
                      {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <BatchStatusBadge batch={batch} />
                  </TableCell>
                  <TableCell>
                    <BatchProgress batch={batch} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <time
                      dateTime={batch.createdAt}
                      title={dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                      className="font-mono text-[13px] whitespace-nowrap"
                    >
                      {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm")}
                    </time>
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="hidden lg:table-cell">
                      {batch.userName ?? "Deleted user"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  );
}
