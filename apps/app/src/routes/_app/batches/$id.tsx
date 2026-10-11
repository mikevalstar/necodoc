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
import { ChevronLeftIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
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

const rowsQuery = (batchId: string, page: number, running: boolean) =>
  queryOptions({
    queryKey: ["generations", "batch", batchId, page],
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
    refetchInterval: running ? 1500 : false,
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
  const rows = useQuery(rowsQuery(id, page, batch.status === "running"));
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: async () => (await ok(api.batches[":id"].cancel.$post({ param: { id } }))).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["batches"] }),
  });
  const pages = Math.max(1, Math.ceil(batch.total / PAGE_SIZE));
  const hasPdfs = batch.done > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <Link
        to="/batches"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Batches
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">
          {batch.templateName} <span className="text-muted-foreground">v{batch.version}</span>
        </h1>
        <BatchStatusBadge status={batch.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {hasPdfs && (
            <>
              <a href={`/api/batches/${id}/zip`} className={buttonVariants({ variant: "outline" })}>
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
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel remaining
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Started {dayjs(batch.createdAt).format("YYYY-MM-DD HH:mm:ss")}
        {batch.userName && ` by ${batch.userName}`}
        {batch.finishedAt &&
          `, finished ${dayjs(batch.finishedAt).format("HH:mm:ss")} (${dayjs(batch.finishedAt).from(batch.createdAt, true)})`}
        . Downloads include the PDFs rendered so far.
      </p>
      <BatchProgress {...batch} />
      <ErrorAlert error={cancel.error ?? rows.error} />

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
    </main>
  );
}
