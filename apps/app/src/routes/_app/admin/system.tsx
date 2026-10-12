import {
  type MetricsWindow,
  metricsWindowSchema,
  type Percentiles,
  type PublishingSettings,
  publishingSettingsSchema,
  type RetentionSettings,
} from "@necodoc/shared";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
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
import { formatMs, sourceLabels } from "../generations/-generation-actions";

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (Admin > System), the retention
// setting from docs/features/generation-log.md, and the publishing settings from
// docs/features/review-and-approval.md.

/** Offline processes seen longer ago than this are folded away. */
const STALE_MINUTES = 15;

const systemQuery = (window: MetricsWindow) =>
  queryOptions({
    queryKey: ["system", window],
    queryFn: async () => (await ok(api.system.$get({ query: { window } }))).json(),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

const retentionQuery = queryOptions({
  queryKey: ["system", "retention"],
  queryFn: async () => (await ok(api.system.retention.$get())).json(),
});

const publishingQuery = queryOptions({
  queryKey: ["system", "publishing"],
  queryFn: async () => (await ok(api.system.publishing.$get())).json(),
});

const publishingLabels: Record<keyof PublishingSettings, { label: string; description: string }> = {
  requireReview: {
    label: "Require review before publish",
    description: "Only a draft matching an approved review can be published.",
  },
  allowSelfApproval: {
    label: "Allow self-approval",
    description: "Reviewers may approve drafts they submitted themselves.",
  },
  blockOnFailingTests: {
    label: "Block publish when tests fail",
    description: "Publishing runs the template's test cases and stops if one fails.",
  },
};

const windowLabels = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
} satisfies Record<MetricsWindow, string>;

export const Route = createFileRoute("/_app/admin/system")({
  validateSearch: z.object({ window: metricsWindowSchema.default("1h") }),
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: System,
});

const pct = (p: Percentiles) => `${formatMs(p.p50)} / ${formatMs(p.p95)} / ${formatMs(p.p99)}`;

function System() {
  const { window } = Route.useSearch();
  const navigate = Route.useNavigate();
  const system = useQuery(systemQuery(window));
  const data = system.data;
  const workersOnline = data?.workers.filter((w) => w.online && w.role !== "api") ?? [];
  // Restarts leave offline rows behind for a day (the API prunes after 24h); old ones are noise.
  const [showOld, setShowOld] = useState(false);
  const recent = dayjs().subtract(STALE_MINUTES, "minute");
  const isOld = (w: { online: boolean; lastSeen: string }) =>
    !w.online && dayjs(w.lastSeen).isBefore(recent);
  const oldCount = data?.workers.filter(isOld).length ?? 0;
  const processes = data?.workers.filter((w) => showOld || !isOld(w)) ?? [];

  return (
    <Page>
      <PageHeader
        title="System"
        description="Render workers, the queue and render times. Refreshes every 5 seconds."
        actions={
          <>
            <FaqLink feature="System metrics" />
            <NativeSelect
              aria-label="Window"
              value={window}
              onChange={(e) =>
                navigate({ search: { window: metricsWindowSchema.parse(e.target.value) } })
              }
            >
              {metricsWindowSchema.options.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {windowLabels[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </>
        }
      />
      <ErrorAlert error={system.error} />

      {data && workersOnline.length === 0 && (
        <Alert variant="destructive">
          <AlertTitle>No render workers online</AlertTitle>
          <AlertDescription>
            Logged renders wait in the queue until a process with ROLE=worker or ROLE=all starts.
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Queued (interactive / batch)">
              {data.queue.interactive.queued} / {data.queue.batch.queued}
            </Stat>
            <Stat label="Running (interactive / batch)">
              {data.queue.interactive.running} / {data.queue.batch.running}
            </Stat>
            <Stat label="Renders per minute">{data.metrics.rendersPerMinute.toFixed(2)}</Stat>
            <Stat label="Error rate">
              {data.metrics.errorRate === null
                ? "—"
                : `${(data.metrics.errorRate * 100).toFixed(1)}% of ${data.metrics.renders}`}
            </Stat>
            <Stat label="Total time p50 / p95 / p99" wide>
              {pct(data.metrics.totalMs)}
            </Stat>
            <Stat label="Queue wait p50 / p95 / p99" wide>
              {pct(data.metrics.queueWaitMs)}
            </Stat>
            <Stat label={`Output storage: ${data.storage.target}`} wide>
              {data.storage.driver}
              {data.storage.redirect === "presigned" ? " (presigned redirects)" : ""}
            </Stat>
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">Processes</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Process</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Running</TableHead>
                  <TableHead>Event-loop lag</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processes.map((w) => (
                  <TableRow key={w.id} className={w.online ? undefined : "opacity-50"}>
                    <TableCell className="font-mono text-xs">{w.id}</TableCell>
                    <TableCell>
                      <Badge variant={w.online ? "secondary" : "outline"}>
                        {w.role}
                        {!w.online && " (offline)"}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.version}</TableCell>
                    <TableCell>
                      {w.role === "api" ? "—" : `${w.running} of ${w.concurrency}`}
                    </TableCell>
                    <TableCell>{w.eventLoopLagMs} ms</TableCell>
                    <TableCell>{dayjs(w.lastSeen).fromNow()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {oldCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowOld(!showOld)}>
                {showOld
                  ? "Hide older offline processes"
                  : `Show ${oldCount} offline ${oldCount === 1 ? "process" : "processes"} last seen over ${STALE_MINUTES} minutes ago`}
              </Button>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown
              title="By source"
              rows={data.bySource.map((row) => ({
                ...row,
                key: row.source,
                label: sourceLabels[row.source],
              }))}
            />
            <Breakdown
              title="By template (top 20)"
              rows={data.byTemplate.map((row) => ({
                ...row,
                key: row.templateId,
                label: row.templateName ?? "Deleted template",
              }))}
            />
          </div>
        </>
      )}

      <PublishingSection />
      <RetentionSection />
    </Page>
  );
}

function Stat({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-lg border p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: {
    key: string;
    label: string;
    renders: number;
    errors: number;
    p50TotalMs: number | null;
    p95TotalMs: number | null;
  }[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-medium">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>Renders</TableHead>
            <TableHead>Errors</TableHead>
            <TableHead>p50 / p95 total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{row.label}</TableCell>
              <TableCell>{row.renders}</TableCell>
              <TableCell>{row.errors}</TableCell>
              <TableCell>
                {formatMs(row.p50TotalMs)} / {formatMs(row.p95TotalMs)}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                Nothing rendered in this window.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

const daysInput = (value: string) => (value.trim() === "" ? null : Number(value));

function RetentionSection() {
  const retention = useQuery(retentionQuery);
  return retention.data ? (
    <RetentionForm key={JSON.stringify(retention.data)} saved={retention.data} />
  ) : (
    <ErrorAlert error={retention.error} />
  );
}

function RetentionForm({ saved }: { saved: RetentionSettings }) {
  const queryClient = useQueryClient();
  const [outputDays, setOutputDays] = useState(saved.outputDays?.toString() ?? "");
  const [inputDays, setInputDays] = useState(saved.inputDays?.toString() ?? "");
  const save = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.system.retention.$put({
            json: { outputDays: daysInput(outputDays), inputDays: daysInput(inputDays) },
          }),
        )
      ).json(),
    onSuccess: (data) => queryClient.setQueryData(retentionQuery.queryKey, data),
  });
  const run = useMutation({
    mutationFn: async () => (await ok(api.system.retention.run.$post())).json(),
  });
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="font-medium">Retention</h2>
        <p className="text-sm text-muted-foreground">
          Deletes generated PDFs, and optionally inputs, of generations that finished more than N
          days ago. The log entries stay. Runs daily at 03:17 UTC; leave a box empty to keep
          forever.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="outputDays">Delete PDFs after (days)</FieldLabel>
          <Input
            id="outputDays"
            type="number"
            min={1}
            className="w-32"
            value={outputDays}
            onChange={(e) => setOutputDays(e.target.value)}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="inputDays">Delete inputs after (days)</FieldLabel>
          <Input
            id="inputDays"
            type="number"
            min={1}
            className="w-32"
            value={inputDays}
            onChange={(e) => setInputDays(e.target.value)}
          />
          <FieldDescription>Re-run needs the input.</FieldDescription>
        </Field>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
          Run now
        </Button>
      </div>
      <ErrorAlert error={save.error ?? run.error} />
      {run.data && (
        <p className="text-sm text-muted-foreground" role="status">
          Deleted {run.data.outputsDeleted} PDFs and {run.data.inputsDeleted} inputs.
        </p>
      )}
    </section>
  );
}

/** Each switch saves on change. */
function PublishingSection() {
  const queryClient = useQueryClient();
  const settings = useQuery(publishingQuery);
  const save = useMutation({
    mutationFn: async (json: PublishingSettings) =>
      (await ok(api.system.publishing.$put({ json }))).json(),
    onSuccess: (data) => queryClient.setQueryData(publishingQuery.queryKey, data),
  });
  const current = settings.data;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="font-medium">Publishing</h2>
        <p className="text-sm text-muted-foreground">
          Review and test gates for publishing template versions.
        </p>
      </div>
      <ErrorAlert error={settings.error ?? save.error} />
      {current &&
        publishingSettingsSchema.keyof().options.map((key) => (
          <Field key={key} orientation="horizontal">
            <Switch
              id={`publishing-${key}`}
              checked={current[key]}
              disabled={save.isPending}
              onCheckedChange={(checked) => save.mutate({ ...current, [key]: checked })}
            />
            <div className="space-y-0.5">
              <FieldLabel htmlFor={`publishing-${key}`}>{publishingLabels[key].label}</FieldLabel>
              <FieldDescription>{publishingLabels[key].description}</FieldDescription>
            </div>
          </Field>
        ))}
    </section>
  );
}
