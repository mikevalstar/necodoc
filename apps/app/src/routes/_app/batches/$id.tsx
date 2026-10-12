import { isFinishedStatus } from "@necodoc/shared";
import {
  CaretLeftIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ComponentProps, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { BackLink, FaqLink, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";
import { formatMs, StatusBadge } from "../generations/-generation-actions";
import { BatchProgress, BatchStatusBadge, remaining } from "./-batch-status";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (batch jobs). Polls while running.
const PAGE_SIZE = 50;

const batchQuery = (id: string) =>
  queryOptions({
    queryKey: ["batches", id],
    queryFn: async () => (await ok(api.batches[":id"].$get({ param: { id } }))).json(),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
  });

type RowFilter = "all" | "failed";

/**
 * `progress` (rows finished so far) is in the key, so the table refetches whenever the counter
 * above it moves, the last time included, rather than on its own timer that can lag behind it.
 */
const rowsQuery = (batchId: string, filter: RowFilter, page: number, progress: number) =>
  queryOptions({
    queryKey: ["generations", "batch", batchId, filter, page, progress],
    queryFn: async () =>
      (
        await ok(
          api.generations.$get({
            query: {
              batchId,
              ...(filter === "failed" ? { status: "error" } : {}),
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

const stamp = (at: string) => dayjs(at).format("YYYY-MM-DD HH:mm:ss");

function BatchDetail() {
  const { id } = Route.useParams();
  const batch = useSuspenseQuery(batchQuery(id)).data;
  usePageCrumb(`${batch.templateName} batch`);
  const [filter, setFilter] = useState<RowFilter>("all");
  const [page, setPage] = useState(1);
  const left = remaining(batch);
  const progress = batch.total - left;
  const rows = useQuery(rowsQuery(id, filter, page, progress));
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
  const shown = filter === "failed" ? batch.failed : batch.total;
  const pages = Math.max(1, Math.ceil((rows.data?.total ?? shown) / PAGE_SIZE));
  const running = batch.status === "running";
  // While it runs, how far along it is; once it stops, how much of it became PDFs.
  const headline = running ? progress : batch.done;
  const pct = batch.total ? Math.floor((headline / batch.total) * 100) : 0;
  const showRows = (next: RowFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/batches">Batches</BackLink>}
        title={
          <span title={batch.templateName}>
            {batch.templateName} <span className="text-ink-3">v{batch.version}</span>
          </span>
        }
        description={
          <>
            {batch.total.toLocaleString()} {batch.total === 1 ? "row" : "rows"}, started{" "}
            <time dateTime={batch.createdAt} title={stamp(batch.createdAt)}>
              {dayjs(batch.createdAt).fromNow()}
            </time>
            {batch.userName && ` by ${batch.userName}`}
            {batch.finishedAt && (
              <>
                , finished in{" "}
                <time dateTime={batch.finishedAt} title={stamp(batch.finishedAt)}>
                  {dayjs(batch.finishedAt).from(batch.createdAt, true)}
                </time>
              </>
            )}
            .{running && batch.done > 0 && " Downloads include the PDFs rendered so far."}
          </>
        }
        actions={
          <>
            <FaqLink feature="Batches" />
            {running && (
              <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
                Cancel remaining
              </Button>
            )}
            {batch.done > 0 && (
              <>
                <a
                  href={`/api/batches/${id}/packet`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <DownloadSimpleIcon />
                  Packet PDF
                </a>
                <a href={`/api/batches/${id}/zip`} className={buttonVariants()}>
                  <DownloadSimpleIcon />
                  Download ZIP
                </a>
              </>
            )}
          </>
        }
      >
        <BatchStatusBadge batch={batch} />
      </PageHeader>

      <Card className="gap-4 px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <span className="font-heading text-[34px] leading-none font-extrabold tracking-tight tabular-nums">
              {pct}%
            </span>
            <span className="text-sm text-ink-2 tabular-nums">
              {headline.toLocaleString()} of {batch.total.toLocaleString()} rows{" "}
              {running ? "finished" : "rendered"}
            </span>
          </div>
          {batch.cancelledAt && (
            <span className="text-sm text-ink-3">
              Cancelled{" "}
              <time dateTime={batch.cancelledAt} title={stamp(batch.cancelledAt)}>
                {dayjs(batch.cancelledAt).fromNow()}
              </time>
            </span>
          )}
        </div>
        <BatchProgress batch={batch} counts={false} />
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Count label="Rendered" value={batch.done} dot="bg-brand" />
          <Count
            label="Failed"
            value={batch.failed}
            dot="bg-bad"
            className={batch.failed > 0 ? "text-bad" : undefined}
          />
          <Count label="Cancelled" value={batch.cancelled} dot="bg-ink-3/40" />
          <Count
            label={running ? "Queued or rendering" : "Remaining"}
            value={left}
            dot="bg-tint-2"
          />
        </dl>
      </Card>

      {batch.failed > 0 && filter === "all" && (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle className="font-semibold">
            {batch.failed === 1 ? "1 row failed" : `${batch.failed.toLocaleString()} rows failed`}
          </AlertTitle>
          <AlertDescription>
            <p>
              Failed rows have no PDF and aren't in the downloads. Each one shows its error; fix
              those rows in the CSV and run them as a new batch.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => showRows("failed")}>
              Show failed rows
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel the remaining rows?"
          description={`${left.toLocaleString()} of ${batch.total.toLocaleString()} rows haven't finished. Queued rows are cancelled; rows already rendering finish and keep their PDFs. This can't be undone.`}
          confirmLabel="Cancel remaining"
          pending={cancel.isPending}
          error={cancel.error}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirmCancel(false)}
        />
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <fieldset aria-label="Rows to show" className="flex gap-0.5 rounded-[10px] bg-tint p-0.5">
            <FilterButton active={filter === "all"} onClick={() => showRows("all")}>
              All rows <span className="text-ink-3">{batch.total.toLocaleString()}</span>
            </FilterButton>
            <FilterButton
              active={filter === "failed"}
              disabled={batch.failed === 0}
              onClick={() => showRows("failed")}
            >
              Failed{" "}
              <span className={batch.failed > 0 ? "text-bad" : "text-ink-3"}>
                {batch.failed.toLocaleString()}
              </span>
            </FilterButton>
          </fieldset>
          <DensityToggle />
        </div>
        {rows.error && (
          <div className="px-5 pb-3">
            <ErrorAlert error={rows.error} />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Row</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead>File or error</TableHead>
              <TableHead className="hidden text-right md:table-cell">Queue wait</TableHead>
              <TableHead className="hidden text-right md:table-cell">Total</TableHead>
              <TableHead className="hidden xl:table-cell">Worker</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.data?.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    to="/generations/$id"
                    params={{ id: row.id }}
                    className="font-semibold text-brand-ink tabular-nums hover:underline"
                    aria-label={`Row ${row.batchRow}: open in the generation log`}
                  >
                    {row.batchRow}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.attempts > 1 && (
                    <div className="mt-0.5 text-xs text-ink-3">{row.attempts} attempts</div>
                  )}
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  {row.error ? (
                    <div className="flex gap-1.5 text-[13px] break-words text-bad">
                      <WarningCircleIcon weight="bold" className="mt-0.5 size-3.5 shrink-0" />
                      <span>{row.error}</span>
                    </div>
                  ) : (
                    <span className="block truncate" title={row.filename}>
                      {row.filename}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {formatMs(row.queueWaitMs)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {isFinishedStatus(row.status) ? formatMs(row.totalMs) : "—"}
                </TableCell>
                <TableCell className="hidden font-mono text-[13px] xl:table-cell">
                  {row.workerId ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {rows.isPending && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-24 text-center text-ink-3">
                  Loading rows…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-1 px-5 py-2.5 text-sm text-ink-3">
            <span className="mr-2 tabular-nums" aria-live="polite">
              Page {page} of {pages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <CaretLeftIcon weight="bold" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <CaretRightIcon weight="bold" />
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}

function Count({
  label,
  value,
  dot,
  className,
}: {
  label: string;
  value: number;
  dot: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-tint px-3.5 py-2.5">
      <dt className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-3">
        <span className={cn("size-2 rounded-full", dot)} aria-hidden />
        {label}
      </dt>
      <dd
        className={cn(
          "font-heading text-[22px] leading-tight font-extrabold tabular-nums",
          className,
        )}
      >
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function FilterButton({
  active,
  children,
  ...props
}: { active: boolean; children: ReactNode } & Omit<
  ComponentProps<"button">,
  "type" | "aria-pressed"
>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold text-ink-2 tabular-nums hover:text-ink disabled:pointer-events-none disabled:opacity-50",
        active && "bg-surface text-ink shadow-card",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
