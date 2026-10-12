import { type JobState, jobStateSchema, type QueueJob, type WorkerStatus } from "@necodoc/shared";
import { ArrowClockwiseIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { StatTile } from "@/components/charts";
import {
  DataTable,
  type DataTableFeatures,
  dataTableSearchSchema,
  FilterSelect,
} from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";
import { useRerun } from "../generations/-generation-actions";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (Admin > Queue). The API reads
// pg-boss's job table, filters and pages; it has no sort, so the order is fixed (running first,
// then by priority, oldest first).

const refreshMs = 2500;
/** Offline workers seen longer ago than this are left out (Admin > System lists them all). */
const STALE_MINUTES = 15;

const stateLabels = {
  created: "Queued",
  retry: "Retrying",
  active: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
} satisfies Record<JobState, string>;

const stateVariants = {
  created: "secondary",
  retry: "warn",
  active: "run",
  completed: "ok",
  cancelled: "secondary",
  failed: "bad",
} as const satisfies Record<JobState, string>;

/** Jobs the worker hasn't finished with: the ones that can still be cancelled. */
const cancellable = new Set<JobState>(["created", "retry", "active"]);

/** The filter row: the default view first, then the states in the order a job moves through them. */
const views = [
  { state: undefined, label: "Current" },
  ...(["created", "retry", "active", "failed", "completed", "cancelled"] as const).map((state) => ({
    state,
    label: stateLabels[state],
  })),
];

const emptyText = {
  created: "Nothing is waiting.",
  retry: "Nothing is waiting to retry.",
  active: "Nothing is rendering right now.",
  completed: "No completed jobs kept.",
  cancelled: "No cancelled jobs kept.",
  failed: "No failed jobs kept.",
} satisfies Record<JobState, string>;

const searchSchema = dataTableSearchSchema(["createdOn"], "createdOn").extend({
  state: jobStateSchema.optional(),
  queue: z.string().optional(),
});
type QueueSearch = z.infer<typeof searchSchema>;

function queueQuery(search: QueueSearch, refetchInterval: number | false) {
  const query = {
    state: search.state,
    queue: search.queue,
    limit: String(search.pageSize),
    offset: String((search.page - 1) * search.pageSize),
  };
  return queryOptions({
    queryKey: ["system", "queue", query],
    queryFn: async () => (await ok(api.system.queue.$get({ query }))).json(),
    refetchInterval,
    placeholderData: keepPreviousData,
  });
}

/** Same request (and cache entry) as Admin > System's shortest window; only workers are used. */
const workersQuery = (refetchInterval: number | false) =>
  queryOptions({
    queryKey: ["system", "15m"],
    queryFn: async () => (await ok(api.system.$get({ query: { window: "15m" } }))).json(),
    refetchInterval,
    placeholderData: keepPreviousData,
  });

/** "4s", "3m 12s", "2h 05m". */
function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

function ago(value: string | null) {
  return value ? (
    <time
      dateTime={value}
      className="whitespace-nowrap"
      title={dayjs(value).format("YYYY-MM-DD HH:mm:ss")}
    >
      {dayjs(value).fromNow()}
    </time>
  ) : (
    "—"
  );
}

const column = createColumnHelper<DataTableFeatures, QueueJob>();
const columns = column.columns([
  column.accessor("state", {
    header: "State",
    cell: ({ getValue }) => (
      <Badge variant={stateVariants[getValue()]} dot>
        {stateLabels[getValue()]}
      </Badge>
    ),
    enableHiding: false,
  }),
  column.accessor("filename", {
    header: "File",
    cell: ({ row: { original } }) =>
      original.generationId ? (
        <Link
          to="/generations/$id"
          params={{ id: original.generationId }}
          className="font-semibold hover:underline"
          title={original.filename ?? undefined}
        >
          {original.filename ?? "Generation"}
        </Link>
      ) : (
        <span className="text-ink-3">—</span>
      ),
    meta: { className: "max-w-56 truncate" },
    enableHiding: false,
  }),
  column.accessor("queue", {
    header: "Queue",
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
  }),
  column.accessor("priority", {
    header: "Priority",
    cell: ({ getValue }) => (getValue() > 0 ? "Interactive" : "Batch"),
    meta: { className: "max-lg:hidden" },
  }),
  column.accessor("batchId", {
    header: "Batch",
    cell: ({ getValue }) => {
      const id = getValue();
      return id ? (
        <Link to="/batches/$id" params={{ id }} className="text-brand-ink hover:underline">
          Open batch
        </Link>
      ) : (
        <span className="text-ink-3">—</span>
      );
    },
    meta: { className: "max-lg:hidden" },
  }),
  column.accessor("workerId", {
    header: "Worker",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-ink-2" title={getValue() ?? undefined}>
        {getValue() ?? "—"}
      </span>
    ),
    meta: { className: "max-w-44 truncate max-xl:hidden" },
  }),
  column.display({
    id: "retries",
    header: "Attempts",
    cell: ({ row: { original } }) => (
      <span className={cn(original.retryCount > 0 && "font-semibold text-warn")}>
        {original.retryCount + 1} of {original.retryLimit + 1}
      </span>
    ),
    meta: { className: "whitespace-nowrap tabular-nums max-xl:hidden" },
  }),
  column.accessor("createdOn", { header: "Queued", cell: ({ getValue }) => ago(getValue()) }),
  column.accessor("startedOn", {
    header: "Started",
    cell: ({ getValue }) => ago(getValue()),
    meta: { hiddenByDefault: true },
  }),
  column.accessor("completedOn", {
    header: "Finished",
    cell: ({ getValue }) => ago(getValue()),
    meta: { hiddenByDefault: true },
  }),
  column.display({
    id: "age",
    header: "Age",
    cell: ({ row: { original } }) => (
      <span
        title={
          original.completedOn ? "Queued to finished" : "Time since it was queued (still going)"
        }
      >
        {duration(dayjs(original.completedOn ?? undefined).diff(original.createdOn, "second"))}
      </span>
    ),
    meta: { className: "text-right whitespace-nowrap tabular-nums" },
  }),
]);

export const Route = createFileRoute("/_app/admin/queue")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: Queue,
});

function Queue() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const [live, setLive] = useState(true);
  const [toCancel, setToCancel] = useState<QueueJob | null>(null);
  const jobs = useQuery(queueQuery(search, live && refreshMs));
  const system = useQuery(workersQuery(live && refreshMs));
  const rerun = useRerun();

  const cancel = useMutation({
    mutationFn: async (jobId: string) =>
      (await ok(api.system.queue[":jobId"].cancel.$post({ param: { jobId } }))).json(),
    onSuccess: (result) => {
      setToCancel(null);
      // The list can be a few seconds old (or paused), so the job may have finished meanwhile.
      if (!result.generationId || result.generationCancelled) toast.success("Job cancelled");
      else toast.info("It had already finished", { description: "Its result was kept." });
      return queryClient.invalidateQueries({ queryKey: ["system", "queue"] });
    },
  });

  const setSearch = (next: Partial<QueueSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });

  const data = jobs.data;
  const counts = data?.counts.filter((row) => !search.queue || row.queue === search.queue);
  const countOf = (...states: JobState[]) =>
    counts?.reduce((sum, row) => sum + (states.includes(row.state) ? row.count : 0), 0);
  const queues = [...new Set(data?.counts.map((row) => row.queue))];

  // Exact across every waiting job (in the chosen queue), not just this page.
  const oldest = data?.oldestWaitingAt ?? null;

  const recent = dayjs().subtract(STALE_MINUTES, "minute");
  const workers =
    system.data?.workers.filter(
      (w) => w.role !== "api" && (w.online || dayjs(w.lastSeen).isAfter(recent)),
    ) ?? [];
  const online = workers.filter((w) => w.online);
  const slots = online.reduce((sum, w) => sum + w.concurrency, 0);

  return (
    <Page>
      <PageHeader
        title="Queue"
        description="What the render workers are doing now: jobs waiting, running and failed, with the workers picking them up."
        actions={
          <>
            <FaqLink feature="Render queue view" />
            <Button variant="outline" onClick={() => setLive(!live)}>
              {live ? <PauseIcon /> : <PlayIcon />}
              {live ? "Pause updates" : "Resume updates"}
            </Button>
          </>
        }
      >
        {live ? (
          <Badge variant="run" dot>
            Live
          </Badge>
        ) : (
          <Badge variant="warn" dot>
            Paused
            {jobs.dataUpdatedAt > 0 && ` at ${dayjs(jobs.dataUpdatedAt).format("HH:mm:ss")}`}
          </Badge>
        )}
      </PageHeader>

      {system.data && online.length === 0 && (
        <Alert variant="destructive">
          <AlertTitle>No render workers online</AlertTitle>
          <AlertDescription>
            Jobs wait in the queue until a process with ROLE=worker or ROLE=all starts.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Waiting"
          value={fmt(countOf("created", "retry"))}
          hint={retryHint(countOf("retry"))}
        />
        <StatTile
          label="Running"
          value={fmt(countOf("active"))}
          hint={
            system.data &&
            `${slots} ${slots === 1 ? "slot" : "slots"} on ${online.length} ${online.length === 1 ? "worker" : "workers"}`
          }
        />
        <StatTile
          label="Oldest waiting"
          value={oldest ? duration(dayjs().diff(oldest, "second")) : "—"}
          hint={
            !data
              ? undefined
              : oldest
                ? `Queued ${dayjs(oldest).format("HH:mm:ss")}`
                : "Nothing waiting"
          }
        />
        <StatTile label="Failed" value={fmt(countOf("failed"))} hint="Still kept by the queue" />
      </div>

      <Workers loading={!system.data} workers={workers} />

      <ErrorAlert error={rerun.error} />

      <DataTable
        columns={columns}
        rows={data?.items}
        total={data?.total}
        getRowId={(job) => job.id}
        state={search}
        onStateChange={setSearch}
        sortable={[]}
        isFetching={jobs.isPlaceholderData}
        error={jobs.error}
        noun="job"
        empty={
          search.state
            ? emptyText[search.state]
            : "The queue is clear: nothing waiting or running, and no failures in the last 24 hours."
        }
        rowActions={(job) => (
          <div className="flex justify-end">
            {cancellable.has(job.state) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-bad"
                aria-label={`Cancel ${job.filename ?? "job"}`}
                onClick={() => {
                  cancel.reset();
                  setToCancel(job);
                }}
              >
                Cancel
              </Button>
            )}
            {job.state === "failed" && job.generationId && (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Re-run ${job.filename ?? "job"}`}
                title="Render the same input again as a new entry"
                disabled={rerun.isPending}
                onClick={() => job.generationId && rerun.mutate(job.generationId)}
              >
                <ArrowClockwiseIcon weight="bold" />
                Re-run
              </Button>
            )}
          </div>
        )}
        toolbar={
          <>
            <fieldset
              aria-label="Job state"
              className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-tint p-0.5 [scrollbar-width:none]"
            >
              {views.map(({ state, label }) => {
                const count = state ? countOf(state) : undefined;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={search.state === state}
                    title={
                      state ? undefined : "Unfinished jobs plus failures from the last 24 hours"
                    }
                    onClick={() => setSearch({ state, page: 1 })}
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:text-ink",
                      search.state === state && "bg-surface text-ink shadow-card",
                    )}
                  >
                    {label}
                    {count !== undefined && (
                      <span className="font-normal text-ink-3 tabular-nums">
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </fieldset>
            <FilterSelect
              size="sm"
              label="Queue"
              value={search.queue}
              options={queues.map((queue) => ({ value: queue, label: queue }))}
              onChange={(queue) => setSearch({ queue: queue || undefined, page: 1 })}
            />
          </>
        }
      />

      <AlertDialog open={!!toCancel} onOpenChange={(open) => !open && setToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {toCancel?.filename ?? "this job"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {toCancel?.state === "active"
                ? "It is rendering now. The render isn't stopped, but its result is dropped and the generation is marked cancelled."
                : "The job is removed from the queue and its generation is marked cancelled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorAlert error={cancel.error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => toCancel && cancel.mutate(toCancel.id)}
            >
              Cancel job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

const fmt = (count: number | undefined) => (count === undefined ? "—" : count.toLocaleString());

const retryHint = (retrying: number | undefined) =>
  retrying ? `${retrying.toLocaleString()} retrying after a failure` : "Queued for a worker";

/** One pill per render process: online ones with their busy slots, recently gone ones greyed. */
function Workers({ loading, workers }: { loading: boolean; workers: WorkerStatus[] }) {
  let body: ReactNode;
  if (loading) body = <span className="text-ink-3">Loading workers…</span>;
  else if (workers.length === 0)
    body = <span className="text-ink-3">No workers seen recently.</span>;
  else
    body = (
      <ul className="flex flex-wrap gap-2">
        {workers.map((w) => (
          <li key={w.id}>
            <Badge
              variant={w.online ? (w.running > 0 ? "run" : "ok") : "secondary"}
              dot
              className="h-7 font-mono font-normal"
              title={
                w.online
                  ? "Busy slots of its total, at its last heartbeat"
                  : `Last seen ${dayjs(w.lastSeen).fromNow()}`
              }
            >
              {w.id}
              <span className="font-sans font-semibold">
                {w.online ? `${w.running}/${w.concurrency}` : "offline"}
              </span>
            </Badge>
          </li>
        ))}
      </ul>
    );
  return (
    <Card size="sm" className="flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4">
      <h2 className="font-heading text-[15px] font-bold">Workers</h2>
      <div className="min-w-0 flex-1">{body}</div>
      <Link to="/admin/system" className="text-sm font-semibold text-brand-ink hover:underline">
        System
      </Link>
    </Card>
  );
}
