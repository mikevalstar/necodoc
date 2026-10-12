import { PlusIcon, StackIcon } from "@phosphor-icons/react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { BatchProgress, BatchStatusBadge } from "./-batch-status";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). The API scopes
// non-admins to their own batches.
const batchesQuery = queryOptions({
  queryKey: ["batches"],
  queryFn: async () => (await ok(api.batches.$get())).json(),
  refetchInterval: (query) =>
    query.state.data?.some((batch) => batch.status === "running") ? 3000 : false,
});

export const Route = createFileRoute("/_app/batches/")({
  component: Batches,
});

function Batches() {
  const { me } = Route.useRouteContext();
  const isAdmin = me.user.roles.includes("admin");
  const batches = useQuery(batchesQuery);
  return (
    <Page>
      <PageHeader
        title="Batches"
        description="Many documents from one published template, one per CSV or JSON row. Batch rows queue behind interactive renders."
        actions={
          <>
            <FaqLink feature="Batches" />
            <Link to="/batches/new" className={buttonVariants()}>
              <PlusIcon weight="bold" />
              Run batch
            </Link>
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
          action={
            <Link to="/batches/new" className={buttonVariants()}>
              <PlusIcon weight="bold" />
              Run batch
            </Link>
          }
        />
      )}
      {!!batches.data?.length && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-1/3">Progress</TableHead>
              {isAdmin && <TableHead className="hidden md:table-cell">User</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.data?.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    to="/batches/$id"
                    params={{ id: batch.id }}
                    className="font-medium hover:underline"
                  >
                    {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                  </Link>
                </TableCell>
                <TableCell>
                  {batch.templateName}{" "}
                  <span className="text-xs text-muted-foreground">v{batch.version}</span>
                </TableCell>
                <TableCell>
                  <BatchStatusBadge status={batch.status} />
                </TableCell>
                <TableCell>
                  <BatchProgress {...batch} />
                </TableCell>
                {isAdmin && (
                  <TableCell className="hidden md:table-cell">{batch.userName ?? "—"}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
