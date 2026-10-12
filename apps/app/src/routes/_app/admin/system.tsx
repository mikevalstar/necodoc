import {
  type ConfigState,
  certificationState,
  type MetricsWindow,
  metricsWindowSchema,
  type Percentiles,
  type PublishingSettings,
  publishingSettingsSchema,
  type RetentionSettings,
  type SystemConfig,
} from "@necodoc/shared";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { InferResponseType } from "hono/client";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { StatTile } from "@/components/charts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DemoLock } from "@/components/demo-lock";
import { ErrorAlert } from "@/components/form";
import { FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
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
import { requireAccess } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { cn, plural } from "@/lib/utils";
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

/** Fetched once per visit, not polled: it starts Chromium and round-trips storage. */
const configQuery = queryOptions({
  queryKey: ["system", "config"],
  queryFn: async () => (await ok(api.system.config.$get())).json(),
  staleTime: 60_000,
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
  beforeLoad: ({ context }) => requireAccess(context.me, "admin"),
  component: System,
});

type SystemData = InferResponseType<typeof api.system.$get, 200>;
type Process = SystemData["workers"][number];

const tail = (p: Percentiles) => `p95 ${formatMs(p.p95)} · p99 ${formatMs(p.p99)}`;

function System() {
  const { window } = Route.useSearch();
  const navigate = Route.useNavigate();
  const system = useQuery(systemQuery(window));
  const data = system.data;

  return (
    <Page>
      <PageHeader
        title="System"
        description="Health of the render cluster, the queue and render times, plus cluster-wide settings. Status refreshes every 5 seconds."
        actions={
          <>
            <FaqLink feature="System metrics" />
            <NativeSelect
              aria-label="Metrics window"
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
      {system.isPending && <ListSkeleton rows={4} />}
      {data && <Health data={data} window={window} />}
      <ConfigurationCard />

      <section aria-labelledby="settings-heading" className="space-y-3">
        <h2 id="settings-heading" className="font-heading text-xl font-bold tracking-tight">
          Settings
        </h2>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <PublishingCard />
          <RetentionCard />
        </div>
      </section>
    </Page>
  );
}

function Health({ data, window }: { data: SystemData; window: MetricsWindow }) {
  const { queue, metrics } = data;
  const renderers = data.workers.filter((w) => w.online && w.role !== "api");
  const versions = [...new Set(data.workers.filter((w) => w.online).map((w) => w.version))];
  const slots = renderers.reduce((sum, w) => sum + w.concurrency, 0);
  return (
    <>
      {renderers.length === 0 && (
        <Alert variant="destructive">
          <AlertTitle>No render workers online</AlertTitle>
          <AlertDescription>
            Logged renders wait in the queue until a process with ROLE=worker or ROLE=all starts.
          </AlertDescription>
        </Alert>
      )}

      <Card size="sm" className="gap-0 py-0">
        <dl className="grid divide-hair sm:grid-cols-3 sm:divide-x max-sm:divide-y">
          <StatusItem label="Render workers">
            {renderers.length ? (
              <Badge variant="ok" dot>
                {renderers.length} online
              </Badge>
            ) : (
              <Badge variant="bad" dot>
                None online
              </Badge>
            )}
            {slots > 0 && (
              <span className="text-sm text-ink-3">{plural(slots, "render slot")}</span>
            )}
            {data.pausedQueues.length > 0 && (
              <Badge variant="warn" dot title="Admin › Queue resumes it">
                Paused: {data.pausedQueues.join(", ")}
              </Badge>
            )}
          </StatusItem>
          <StatusItem label="Version">
            {versions.length > 1 ? (
              <Badge variant="warn" dot>
                Mixed versions
              </Badge>
            ) : null}
            {versions.map((v) => (
              <Badge key={v} variant="secondary" className="font-mono">
                {v}
              </Badge>
            ))}
            {versions.length === 0 && <span className="text-sm text-ink-3">No process online</span>}
          </StatusItem>
          <StatusItem label="Output storage">
            <Badge variant="secondary">{data.storage.driver}</Badge>
            {data.storage.redirect === "presigned" && (
              <Badge variant="secondary">Presigned redirects</Badge>
            )}
            <span
              className="min-w-0 truncate font-mono text-xs text-ink-3"
              title={data.storage.target}
            >
              {data.storage.target}
            </span>
          </StatusItem>
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Queued"
          value={queue.interactive.queued + queue.batch.queued}
          hint={`${queue.interactive.queued} interactive · ${queue.batch.queued} batch`}
        />
        <StatTile
          label="Running"
          value={queue.interactive.running + queue.batch.running}
          hint={`${queue.interactive.running} interactive · ${queue.batch.running} batch`}
        />
        <StatTile
          label="Renders per minute"
          value={metrics.rendersPerMinute.toFixed(2)}
          hint={`${plural(metrics.renders, "render")} in the ${windowLabels[window].toLowerCase()}`}
        />
        <StatTile
          label="Error rate"
          value={
            metrics.errorRate === null ? (
              "—"
            ) : (
              <span className={cn(metrics.errors > 0 && "text-bad")}>
                {(metrics.errorRate * 100).toFixed(1)}%
              </span>
            )
          }
          hint={
            metrics.errorRate === null
              ? "Nothing finished in this window"
              : `${plural(metrics.errors, "error")} of ${metrics.renders}`
          }
        />
        <StatTile
          label="Total time p50"
          value={formatMs(metrics.totalMs.p50)}
          hint={tail(metrics.totalMs)}
        />
        <StatTile
          label="Queue wait p50"
          value={formatMs(metrics.queueWaitMs.p50)}
          hint={tail(metrics.queueWaitMs)}
        />
      </div>

      <Processes workers={data.workers} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Breakdown
          title="By source"
          first="Source"
          rows={data.bySource.map((row) => ({
            ...row,
            key: row.source,
            label: sourceLabels[row.source],
          }))}
        />
        <Breakdown
          title="By template"
          description="Top 20 by renders"
          first="Template"
          rows={data.byTemplate.map((row) => ({
            ...row,
            key: row.templateId,
            label: row.templateName ?? "Deleted template",
          }))}
        />
      </div>
    </>
  );
}

function StatusItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 px-4 py-3.5">
      <dt className="text-[12.5px] font-semibold text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

/** A card's title row: the heading on the left, controls on the right. */
function CardBar({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
      <div>
        <h3 className="font-heading text-[17px] font-bold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

function Processes({ workers }: { workers: Process[] }) {
  // Restarts leave offline rows behind for a day (the API prunes after 24h); old ones are noise.
  const [showOld, setShowOld] = useState(false);
  const recent = dayjs().subtract(STALE_MINUTES, "minute");
  const isOld = (w: Process) => !w.online && dayjs(w.lastSeen).isBefore(recent);
  const oldCount = workers.filter(isOld).length;
  const shown = workers.filter((w) => showOld || !isOld(w));
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title="Processes"
        description="Every API and worker process that has sent a heartbeat."
      >
        {oldCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={showOld}
            onClick={() => setShowOld(!showOld)}
          >
            {showOld
              ? "Hide older offline"
              : `Show ${oldCount} offline over ${STALE_MINUTES} min ago`}
          </Button>
        )}
      </CardBar>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-3">No process seen recently.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Process</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="max-lg:hidden">Role</TableHead>
              <TableHead className="max-lg:hidden">Version</TableHead>
              <TableHead className="text-right">Running</TableHead>
              <TableHead className="text-right">Event-loop lag</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((w) => (
              <TableRow key={w.id} className={cn(!w.online && "text-ink-3")}>
                <TableCell>
                  <div className="font-mono text-xs">{w.id}</div>
                  <div className="font-mono text-xs text-ink-3 lg:hidden">
                    {w.role} · {w.version}
                  </div>
                </TableCell>
                <TableCell>
                  {w.online ? (
                    <Badge variant="ok" dot>
                      Online
                    </Badge>
                  ) : (
                    <Badge variant="secondary" dot>
                      Offline
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-lg:hidden">
                  <Badge variant="secondary">{w.role}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs max-lg:hidden">{w.version}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {w.role === "api" ? "—" : `${w.running} of ${w.concurrency}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">{w.eventLoopLagMs} ms</TableCell>
                <TableCell title={dayjs(w.lastSeen).format("YYYY-MM-DD HH:mm:ss")}>
                  {dayjs(w.lastSeen).fromNow()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function Breakdown({
  title,
  description,
  first,
  rows,
}: {
  title: string;
  description?: string;
  first: string;
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
    <Card className="gap-0 py-0">
      <CardBar title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-3">Nothing rendered in this window.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{first}</TableHead>
              <TableHead className="text-right">Renders</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="text-right">p50 / p95</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-0 w-full truncate" title={row.label}>
                  {row.label}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.renders}</TableCell>
                <TableCell className={cn("text-right tabular-nums", row.errors > 0 && "text-bad")}>
                  {row.errors}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {formatMs(row.p50TotalMs)} / {formatMs(row.p95TotalMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

const stateBadge = { ok: "ok", warn: "warn", bad: "bad", off: "secondary" } as const;

function Pill({ state, children }: { state: ConfigState; children: ReactNode }) {
  return (
    <Badge variant={stateBadge[state]} dot>
      {children}
    </Badge>
  );
}

const Detail = ({
  children,
  mono,
  title,
}: {
  children: ReactNode;
  mono?: boolean;
  title?: string;
}) => (
  <span
    title={title}
    className={cn("min-w-0 truncate text-sm text-ink-3", mono && "font-mono text-xs")}
  >
    {children}
  </span>
);

const typeLabels = { oidc: "OIDC", saml: "SAML", header: "Trusted header" } as const;

function ConfigurationCard() {
  const config = useQuery(configQuery);
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title="Configuration"
        description="What this API process is set up with (environment variables). No secrets are shown."
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={config.isFetching}
          onClick={() => config.refetch()}
        >
          <ArrowClockwiseIcon weight="bold" />
          {config.isFetching ? "Checking…" : "Check again"}
        </Button>
      </CardBar>
      {config.data ? (
        <ConfigurationList config={config.data} />
      ) : (
        <div className="px-4 py-4">
          <ErrorAlert error={config.error} />
          {config.isPending && <ListSkeleton rows={4} />}
        </div>
      )}
    </Card>
  );
}

function ConfigurationList({ config }: { config: SystemConfig }) {
  const { chromium, ai, auth, certification: cert, storage, tracing, retention } = config;
  const certified = certificationState(cert);
  const keep = (days: number | null, what: string) =>
    days === null ? `${what} kept forever` : `${what} deleted after ${plural(days, "day")}`;
  return (
    // gap-px over a hair background draws the dividers between cells in both layouts.
    <dl className="grid gap-px overflow-hidden rounded-b-xl bg-hair md:grid-cols-2 [&>div]:bg-card">
      <StatusItem label="Instance">
        {config.instance.name ? (
          <>
            <span className="text-sm font-semibold">{config.instance.name}</span>
            {config.instance.env && <Badge variant="secondary">{config.instance.env}</Badge>}
          </>
        ) : (
          <Pill state="off">Not named</Pill>
        )}
        <Detail>
          Role <span className="font-mono text-xs">{config.role}</span>
        </Detail>
      </StatusItem>
      <StatusItem label="Chromium">
        {chromium.version ? (
          <>
            <Pill state="ok">Running</Pill>
            <Detail mono>{chromium.version}</Detail>
          </>
        ) : (
          <>
            <Pill state="bad">Won&apos;t start</Pill>
            <Detail>{chromium.error}</Detail>
          </>
        )}
      </StatusItem>
      <StatusItem label="AI assistant">
        <Pill state={ai.enabled ? "ok" : "off"}>{ai.enabled ? "On" : "Off"}</Pill>
        <Detail mono>{ai.enabled ? ai.model : "No ANTHROPIC_KEY"}</Detail>
      </StatusItem>
      <StatusItem label="Sign-in">
        <Pill state={auth.password ? "ok" : "off"}>Password {auth.password ? "on" : "off"}</Pill>
        <Pill state={auth.trustedHeader ? "ok" : "off"}>
          Trusted header {auth.trustedHeader ? "on" : "off"}
        </Pill>
        {auth.sso.length === 0 ? (
          <Detail>No SSO providers</Detail>
        ) : (
          auth.sso.map((p) => (
            <Badge key={p.id} variant="secondary" title={p.label}>
              <span className="font-mono">{p.id}</span> · {typeLabels[p.type]}
            </Badge>
          ))
        )}
      </StatusItem>
      <StatusItem label="Certification">
        {!cert ? (
          <>
            <Pill state="off">Not configured</Pill>
            <Detail>Certified renders fail until CERTIFY_* is set.</Detail>
          </>
        ) : cert.error || !cert.notAfter ? (
          <>
            <Pill state="bad">Can&apos;t load</Pill>
            <Detail>{cert.error}</Detail>
          </>
        ) : (
          <>
            <Pill state={certified.state}>
              {certified.state === "ok"
                ? `Valid until ${dayjs(cert.notAfter).format("MMM D, YYYY")}`
                : certified.state === "warn"
                  ? `Expires in ${plural(certified.daysLeft ?? 0, "day")}`
                  : "Expired"}
            </Pill>
            <Detail>
              {cert.subject}
              {cert.issuer && ` · issued by ${cert.issuer}`}
            </Detail>
            <Pill state={cert.tsaHost ? "ok" : "off"}>
              {cert.tsaHost ? `Timestamps: ${cert.tsaHost}` : "No timestamp authority"}
            </Pill>
          </>
        )}
      </StatusItem>
      <StatusItem label="Output storage">
        <Pill state={storage.ok ? "ok" : "bad"}>{storage.ok ? "Reachable" : "Unreachable"}</Pill>
        <Badge variant="secondary">{storage.driver}</Badge>
        <Detail mono title={storage.ok ? storage.target : (storage.error ?? undefined)}>
          {storage.ok ? storage.target : storage.error}
        </Detail>
      </StatusItem>
      <StatusItem label="Prometheus metrics">
        <Pill state={config.metricsPort ? "ok" : "off"}>
          {config.metricsPort ? `Port ${config.metricsPort}` : "Off"}
        </Pill>
      </StatusItem>
      <StatusItem label="Traces (OpenTelemetry)">
        <Pill state={tracing.enabled ? "ok" : "off"}>{tracing.enabled ? "Exporting" : "Off"}</Pill>
        {tracing.endpointHost && <Detail mono>{tracing.endpointHost}</Detail>}
      </StatusItem>
      <StatusItem label="Logs">
        <Badge variant="secondary" className="font-mono">
          {config.logging.level}
        </Badge>
        <Badge variant="secondary" className="font-mono">
          {config.logging.format}
        </Badge>
      </StatusItem>
      <StatusItem label="Retention">
        <Pill state={retention.outputDays === null && retention.inputDays === null ? "off" : "ok"}>
          {retention.outputDays === null && retention.inputDays === null ? "Off" : "On"}
        </Pill>
        <Detail>
          {keep(retention.outputDays, "PDFs")} · {keep(retention.inputDays, "inputs")}
        </Detail>
      </StatusItem>
    </dl>
  );
}

/** Each switch saves on change. */
function PublishingCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(publishingQuery);
  const save = useMutation({
    mutationFn: async ({ json }: { json: PublishingSettings; key: keyof PublishingSettings }) =>
      (await ok(api.system.publishing.$put({ json }))).json(),
    onSuccess: (data, { key }) => {
      queryClient.setQueryData(publishingQuery.queryKey, data);
      toast.success(`${publishingLabels[key].label}: ${data[key] ? "on" : "off"}`);
    },
  });
  const current = settings.data;
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title="Publishing"
        description="Review and test gates for publishing template versions. Changes save at once."
      />
      <div className="space-y-4 px-4 py-4">
        <ErrorAlert error={settings.error ?? save.error} />
        {settings.isPending && <ListSkeleton rows={3} />}
        {current &&
          publishingSettingsSchema.keyof().options.map((key) => (
            <Field key={key} orientation="horizontal">
              <Switch
                id={`publishing-${key}`}
                checked={current[key]}
                disabled={save.isPending}
                onCheckedChange={(checked) =>
                  save.mutate({ json: { ...current, [key]: checked }, key })
                }
              />
              <div className="space-y-0.5">
                <FieldLabel htmlFor={`publishing-${key}`}>{publishingLabels[key].label}</FieldLabel>
                <FieldDescription>{publishingLabels[key].description}</FieldDescription>
              </div>
            </Field>
          ))}
      </div>
    </Card>
  );
}

const daysInput = (value: string) => (value.trim() === "" ? null : Number(value));
const daysText = (days: number | null) => days?.toString() ?? "";

function RetentionCard() {
  const retention = useQuery(retentionQuery);
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title="Retention"
        description="Deletes generated PDFs, and optionally inputs, of generations that finished more than N days ago. Log entries stay. Runs daily at 03:17 UTC."
      />
      {retention.data ? (
        // A short retention run would empty the demo for everyone (ADR 0046).
        <DemoLock className="flex flex-col">
          <RetentionForm key={JSON.stringify(retention.data)} saved={retention.data} />
        </DemoLock>
      ) : (
        <div className="px-4 py-4">
          <ErrorAlert error={retention.error} />
          {retention.isPending && <ListSkeleton rows={2} />}
        </div>
      )}
    </Card>
  );
}

function RetentionForm({ saved }: { saved: RetentionSettings }) {
  const queryClient = useQueryClient();
  const [outputDays, setOutputDays] = useState(daysText(saved.outputDays));
  const [inputDays, setInputDays] = useState(daysText(saved.inputDays));
  const [confirmRun, setConfirmRun] = useState(false);
  const dirty =
    outputDays !== daysText(saved.outputDays) || inputDays !== daysText(saved.inputDays);
  const nothingToDelete = saved.outputDays === null && saved.inputDays === null;
  const save = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.system.retention.$put({
            json: { outputDays: daysInput(outputDays), inputDays: daysInput(inputDays) },
          }),
        )
      ).json(),
    onSuccess: (data) => {
      queryClient.setQueryData(retentionQuery.queryKey, data);
      queryClient.invalidateQueries({ queryKey: configQuery.queryKey });
      toast.success("Retention saved");
    },
  });
  const run = useMutation({
    mutationFn: async () => (await ok(api.system.retention.run.$post())).json(),
    onSuccess: (data) => {
      setConfirmRun(false);
      toast.success(
        `Deleted ${plural(data.outputsDeleted, "PDF")} and ${plural(data.inputsDeleted, "input")}`,
      );
    },
  });
  const after = (days: number | null, what: string) =>
    days === null ? null : `${what} older than ${plural(days, "day")}`;
  const runScope = [after(saved.outputDays, "PDFs"), after(saved.inputDays, "inputs")]
    .filter(Boolean)
    .join(" and ");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="outputDays">Delete PDFs after (days)</FieldLabel>
            <Input
              id="outputDays"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="Keep forever"
              value={outputDays}
              onChange={(e) => setOutputDays(e.target.value)}
            />
            <FieldDescription>Empty keeps PDFs forever.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="inputDays">Delete inputs after (days)</FieldLabel>
            <Input
              id="inputDays"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="Keep forever"
              value={inputDays}
              onChange={(e) => setInputDays(e.target.value)}
            />
            <FieldDescription>Re-running a generation needs its input.</FieldDescription>
          </Field>
        </div>
        <ErrorAlert error={save.error} />
      </div>
      <CardFooter className="flex-wrap gap-3 px-4 py-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {dirty && (
          <span className="text-sm text-ink-3" role="status">
            Unsaved changes
          </span>
        )}
        <Button
          type="button"
          variant="destructive"
          className="ml-auto"
          disabled={dirty || nothingToDelete}
          title={
            dirty
              ? "Save first; a run uses the saved settings"
              : nothingToDelete
                ? "Nothing is set to expire"
                : undefined
          }
          onClick={() => setConfirmRun(true)}
        >
          Run now
        </Button>
      </CardFooter>
      {confirmRun && (
        <ConfirmDialog
          title="Run retention now?"
          description={`This permanently deletes ${runScope} (by finish time). The log entries stay. It can't be undone.`}
          confirmLabel="Delete now"
          pending={run.isPending}
          error={run.error}
          onConfirm={() => run.mutate()}
          onClose={() => setConfirmRun(false)}
        />
      )}
    </form>
  );
}
