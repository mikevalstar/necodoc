import { type JobState, jobStateSchema, type QueueJob } from "@necodoc/shared";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { DataTable, type DataTableFeatures, dataTableSearchSchema } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (Admin > Queue). The API reads
// pg-boss's job table, filters and pages; it has no sort, so the order is fixed.

const refreshMs = 2500;

const stateLabels = {
  created: "Queued",
  retry: "Retrying",
  active: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
} satisfies Record<JobState, string>;

const stateVariants = {
  created: "outline",
  retry: "outline",
  active: "default",
  completed: "secondary",
  cancelled: "outline",
  failed: "destructive",
} as const satisfies Record<JobState, string>;

/** Jobs the worker hasn't finished with: the ones that can still be cancelled. */
const cancellable = new Set<JobState>(["created", "retry", "active"]);

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

const column = createColumnHelper<DataTableFeatures, QueueJob>();
const columns = column.columns([
  column.accessor("state", {
    header: "State",
    cell: ({ getValue }) => (
      <Badge variant={stateVariants[getValue()]}>{stateLabels[getValue()]}</Badge>
    ),
    enableHiding: false,
  }),
  column.accessor("queue", { header: "Queue", cell: ({ getValue }) => getValue() }),
  column.accessor("priority", {
    header: "Priority",
    meta: { className: "text-right tabular-nums" },
  }),
  column.accessor("filename", {
    header: "File",
    cell: ({ row: { original } }) =>
      original.generationId ? (
        <Link
          to="/generations/$id"
          params={{ id: original.generationId }}
          className="hover:underline"
          title={original.filename ?? undefined}
        >
          {original.filename ?? original.generationId}
        </Link>
      ) : (
        "—"
      ),
    meta: { className: "max-w-56 truncate" },
  }),
  column.accessor("batchId", {
    header: "Batch",
    cell: ({ getValue }) => {
      const id = getValue();
      return id ? (
        <Link to="/batches/$id" params={{ id }} className="hover:underline">
          Batch
        </Link>
      ) : (
        "—"
      );
    },
  }),
  column.accessor("workerId", {
    header: "Worker",
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() ?? "—"}</span>,
  }),
  column.display({
    id: "retries",
    header: "Retries",
    cell: ({ row: { original } }) => `${original.retryCount}/${original.retryLimit}`,
    meta: { className: "text-right tabular-nums" },
  }),
  column.accessor("createdOn", { header: "Created", cell: ({ getValue }) => ago(getValue()) }),
  column.accessor("startedOn", { header: "Started", cell: ({ getValue }) => ago(getValue()) }),
  column.accessor("completedOn", {
    header: "Completed",
    cell: ({ getValue }) => ago(getValue()),
    meta: { hiddenByDefault: true },
  }),
  column.display({
    id: "age",
    header: "Age",
    cell: ({ row: { original } }) =>
      `${dayjs(original.completedOn ?? undefined).diff(original.createdOn, "second")}s`,
    meta: { className: "text-right tabular-nums" },
  }),
]);

function ago(value: string | null) {
  return value ? (
    <span className="whitespace-nowrap" title={dayjs(value).format("YYYY-MM-DD HH:mm:ss")}>
      {dayjs(value).fromNow()}
    </span>
  ) : (
    "—"
  );
}

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

  const cancel = useMutation({
    mutationFn: async (jobId: string) =>
      (await ok(api.system.queue[":jobId"].cancel.$post({ param: { jobId } }))).json(),
    onSuccess: () => {
      setToCancel(null);
      toast.success("Job cancelled");
      return queryClient.invalidateQueries({ queryKey: ["system", "queue"] });
    },
  });

  const setSearch = (next: Partial<QueueSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...next }) });

  const counts = jobs.data?.counts.filter((row) => !search.queue || row.queue === search.queue);
  const countOf = (state: JobState) =>
    counts?.reduce((sum, row) => sum + (row.state === state ? row.count : 0), 0) ?? 0;
  const queues = [...new Set(jobs.data?.counts.map((row) => row.queue))];

  return (
    <Page>
      <PageHeader
        title="Queue"
        description="Live view of the render queue. Defaults to unfinished jobs plus failures from the last 24 hours."
        actions={
          <>
            <FaqLink feature="Render queue view" />
            <Button variant="outline" onClick={() => setLive(!live)} aria-pressed={live}>
              {live ? <PauseIcon /> : <PlayIcon />}
              {live ? "Pause refresh" : "Resume refresh"}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={search.state ? "outline" : "default"}
          onClick={() => setSearch({ state: undefined, page: 1 })}
        >
          Unfinished + recent failures
        </Button>
        {jobStateSchema.options.map((state) => (
          <Button
            key={state}
            size="sm"
            variant={search.state === state ? "default" : "outline"}
            onClick={() => setSearch({ state, page: 1 })}
          >
            {stateLabels[state]}
            <span className="tabular-nums opacity-70">{countOf(state).toLocaleString()}</span>
          </Button>
        ))}
      </div>

      <ErrorAlert error={cancel.error} />

      <DataTable
        columns={columns}
        rows={jobs.data?.items}
        total={jobs.data?.total}
        getRowId={(job) => job.id}
        state={search}
        onStateChange={setSearch}
        sortable={[]}
        isFetching={jobs.isPlaceholderData}
        error={jobs.error}
        noun="job"
        rowActions={(job) =>
          cancellable.has(job.state) && (
            <Button variant="ghost" size="sm" onClick={() => setToCancel(job)}>
              Cancel
            </Button>
          )
        }
        toolbar={
          <Field className="w-auto">
            <FieldLabel htmlFor="queue">Queue</FieldLabel>
            <NativeSelect
              id="queue"
              value={search.queue ?? ""}
              onChange={(e) => setSearch({ queue: e.target.value || undefined, page: 1 })}
            >
              <NativeSelectOption value="">Any</NativeSelectOption>
              {queues.map((queue) => (
                <NativeSelectOption key={queue} value={queue}>
                  {queue}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
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
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
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
