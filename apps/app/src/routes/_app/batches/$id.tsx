import { isFinishedStatus } from "@necodoc/shared";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/form";
import { BackLink, Page, PageHeader } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { formatMs, StatusBadge } from "../generations/-generation-actions";
import { BatchProgress, BatchStatusBadge } from "./-batch-status";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). Polls while running.
const PAGE_SIZE = 50;

const batchQuery = (id: string) =>
  queryOptions({
    queryKey: ["batches", id],
    queryFn: async () => (await ok(api.batches[":id"].$get({ param: { id } }))).json(),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
  });

/**
 * `progress` (rows finished so far) is in the key, so the table refetches whenever the counter
 * above it moves, the last time included, rather than on its own timer that can lag behind it.
 */
const rowsQuery = (batchId: string, page: number, progress: number) =>
  queryOptions({
    queryKey: ["generations", "batch", batchId, page, progress],
    queryFn: async () =>
      (
        await ok(
          api.generations.$get({
            query: {
              batchId,
              sort: "batchRow",
              order: "asc",
              limit: String(PAGE_SIZE),
              offset: String((page - 1) * PAGE_SIZE),
            },
          }),
        )
      ).json(),
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/_app/batches/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(batchQuery(params.id)),
  component: BatchDetail,
});

function BatchDetail() {
  const { id } = Route.useParams();
  const batch = useSuspenseQuery(batchQuery(id)).data;
  const [page, setPage] = useState(1);
  const progress = batch.done + batch.failed + batch.cancelled;
  const rows = useQuery(rowsQuery(id, page, progress));
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useMutation({
    mutationFn: async () => (await ok(api.batches[":id"].cancel.$post({ param: { id } }))).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["batches"] });
      setConfirmCancel(false);
      toast.success("Remaining rows cancelled");
    },
  });
  const pages = Math.max(1, Math.ceil(batch.total / PAGE_SIZE));
  const hasPdfs = batch.done > 0;

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/batches">Batches</BackLink>}
        title={
          <>
            {batch.templateName} <span className="text-muted-foreground">v{batch.version}</span>
          </>
        }
        description={
          <>
            Started {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm:ss")}
            {batch.userName && ` by ${batch.userName}`}
            {batch.finishedAt &&
              `, finished ${dayjs(batch.finishedAt).format("HH:mm:ss")} (${dayjs(batch.finishedAt).from(batch.createdAt, true)})`}
            . Downloads include the PDFs rendered so far.
          </>
        }
        actions={
          <>
            {hasPdfs && (
              <>
                <a
                  href={`/api/batches/${id}/zip`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <DownloadIcon />
                  ZIP
                </a>
                <a
                  href={`/api/batches/${id}/packet`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <DownloadIcon />
                  Packet PDF
                </a>
              </>
            )}
            {batch.status === "running" && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel remaining
              </Button>
            )}
          </>
        }
      >
        <BatchStatusBadge status={batch.status} />
      </PageHeader>
      <BatchProgress {...batch} />
      <ErrorAlert error={rows.error} />
      {confirmCancel && (
        <ConfirmDialog
          title="Cancel the remaining rows?"
          description={`Rows still queued (${batch.total - progress} of ${batch.total}) are cancelled; rows already rendered keep their PDFs. This can't be undone.`}
          confirmLabel="Cancel remaining"
          pending={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirmCancel(false)}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>File / error</TableHead>
            <TableHead className="hidden md:table-cell">Queue wait</TableHead>
            <TableHead className="hidden md:table-cell">Total</TableHead>
            <TableHead className="hidden lg:table-cell">Worker</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.data?.items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link
                  to="/generations/$id"
                  params={{ id: row.id }}
                  className="font-medium hover:underline"
                >
                  {row.batchRow}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
                {row.attempts > 1 && (
                  <div className="text-xs text-muted-foreground">{row.attempts} attempts</div>
                )}
              </TableCell>
              <TableCell className="max-w-md">
                {row.error ? (
                  <span className="text-xs break-words text-destructive">{row.error}</span>
                ) : (
                  <span className="truncate">{row.filename}</span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">{formatMs(row.queueWaitMs)}</TableCell>
              <TableCell className="hidden md:table-cell">
                {isFinishedStatus(row.status) ? formatMs(row.totalMs) : "—"}
              </TableCell>
              <TableCell className="hidden font-mono text-xs lg:table-cell">
                {row.workerId ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </Page>
  );
}
