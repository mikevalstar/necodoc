import {
  type GenerationDetail as Generation,
  isFinishedStatus,
  MASKED,
  type OutputProfile,
} from "@necodoc/shared";
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  FilePdfIcon,
  LinkIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { StatTile } from "@/components/charts";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert } from "@/components/form";
import { BackLink, EmptyState, FaqLink, Page, PageHeader } from "@/components/page";
import { PdfFrame } from "@/components/pdf-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, generationPdfUrl, ok } from "@/lib/api";
import { usePageCrumb } from "@/lib/breadcrumb";
import { dayjs } from "@/lib/date";
import { cn, formatBytes, formatMs } from "@/lib/utils";
import {
  DeleteGenerationDialog,
  SignedLinkDialog,
  StatusBadge,
  sourceLabels,
  useRerun,
} from "./-generation-actions";
import { SigningSection } from "./-signing-package";

// Spec: docs/features/generation-log.md. Queued and running entries refresh until they finish.
const generationQuery = (id: string) =>
  queryOptions({
    queryKey: ["generations", id],
    queryFn: async () => (await ok(api.generations[":id"].$get({ param: { id } }))).json(),
    refetchInterval: (query) =>
      query.state.data && !isFinishedStatus(query.state.data.status) ? 1000 : false,
  });

const time = (at: string | null) => (at ? dayjs(at).format("YYYY-MM-DD HH:mm:ss.SSS") : "—");

export const Route = createFileRoute("/_app/generations/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(generationQuery(params.id)),
  component: GenerationDetail,
});

const linkClass = "font-semibold text-brand-ink underline-offset-4 hover:underline";

function GenerationDetail() {
  const { id } = Route.useParams();
  const generation = useSuspenseQuery(generationQuery(id)).data;
  usePageCrumb(generation.filename);
  const navigate = useNavigate();
  const rerun = useRerun();
  const [deleting, setDeleting] = useState(false);
  const [linking, setLinking] = useState(false);
  const input = generation.input ? JSON.stringify(generation.input, null, 2) : null;
  const finished = isFinishedStatus(generation.status);

  return (
    <Page>
      <PageHeader
        back={<BackLink to="/generations">Generations</BackLink>}
        title={<span title={generation.filename}>{generation.filename}</span>}
        description={
          <>
            {sourceLabels[generation.source]} render by {generation.userName ?? "a deleted user"},
            queued{" "}
            <time dateTime={generation.queuedAt} title={time(generation.queuedAt)}>
              {dayjs(generation.queuedAt).fromNow()}
            </time>
            .
          </>
        }
        actions={
          <>
            <FaqLink feature="Generation log" />
            <Button variant="destructive" onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button
              variant="outline"
              disabled={rerun.isPending}
              onClick={() => rerun.mutate(generation.id)}
            >
              <ArrowCounterClockwiseIcon weight="bold" />
              {rerun.isPending ? "Re-running…" : "Re-run"}
            </Button>
            {generation.hasOutput && (
              <>
                <Button variant="outline" onClick={() => setLinking(true)}>
                  <LinkIcon />
                  Download link
                </Button>
                <a
                  href={generationPdfUrl(generation.id)}
                  download={generation.filename}
                  className={buttonVariants()}
                >
                  <DownloadSimpleIcon />
                  Download PDF
                </a>
              </>
            )}
          </>
        }
      >
        <StatusBadge status={generation.status} />
      </PageHeader>
      <ErrorAlert error={rerun.error} />

      {generation.error && (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle className="font-semibold">Render failed</AlertTitle>
          <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
            {generation.error}
          </AlertDescription>
        </Alert>
      )}
      {generation.warnings.length > 0 && (
        <Alert>
          <WarningIcon className="text-warn" />
          <AlertTitle className="font-semibold">
            {generation.warnings.length === 1
              ? "1 warning"
              : `${generation.warnings.length} warnings`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {generation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatTile label="Total" value={formatMs(generation.totalMs)} hint="Queued to finished" />
        <StatTile label="Run time" value={formatMs(generation.durationMs)} hint="On the worker" />
        <StatTile label="Queue wait" value={formatMs(generation.queueWaitMs)} />
        <StatTile label="Pages" value={generation.pageCount ?? "—"} />
        <StatTile
          label="Size"
          value={generation.size === null ? "—" : formatBytes(generation.size)}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <MetaGroup title="Request">
                <Meta label="Source">{sourceLabels[generation.source]}</Meta>
                <Meta label="User">{generation.userName ?? "Deleted user"}</Meta>
                <Meta label="API key">
                  {generation.apiKeyId ? (
                    <>
                      {generation.apiKeyName ?? "Deleted key"}{" "}
                      <Mono className="text-ink-3">{generation.apiKeyId}</Mono>
                    </>
                  ) : (
                    "None"
                  )}
                </Meta>
                <Meta label="Template">
                  {generation.templateId ? (
                    <Link
                      to="/templates/$id"
                      params={{ id: generation.templateId }}
                      className={linkClass}
                    >
                      {generation.templateName ?? "Deleted template"}
                    </Link>
                  ) : (
                    "None (raw HTML)"
                  )}
                </Meta>
                {generation.subject && (
                  <Meta label="Subject">
                    <span className="break-all">{generation.subject}</span>
                  </Meta>
                )}
                {generation.batchId && (
                  <Meta label="Batch">
                    <Link
                      to="/batches/$id"
                      params={{ id: generation.batchId }}
                      className={linkClass}
                    >
                      Row {generation.batchRow}
                    </Link>
                  </Meta>
                )}
                {generation.rerunOfId && (
                  <Meta label="Re-run of">
                    <Link
                      to="/generations/$id"
                      params={{ id: generation.rerunOfId }}
                      className={cn(linkClass, "font-mono text-xs break-all")}
                    >
                      {generation.rerunOfId}
                    </Link>
                  </Meta>
                )}
              </MetaGroup>
              <MetaGroup title="Output">
                <Meta label="Profile">
                  {generation.outputProfile ? (
                    <OutputPills profile={generation.outputProfile} />
                  ) : generation.status === "success" ? (
                    "As rendered"
                  ) : (
                    "—"
                  )}
                </Meta>
                {generation.input?.output && (
                  <Meta label="Language">
                    <Mono>{generation.input.output.lang}</Mono>
                  </Meta>
                )}
              </MetaGroup>
              <MetaGroup title="Trace">
                <Meta label="Queued">
                  <Mono>{time(generation.queuedAt)}</Mono>
                </Meta>
                <Meta label="Started">
                  <Mono>{time(generation.startedAt)}</Mono>
                </Meta>
                <Meta label="Finished">
                  <Mono>{time(generation.finishedAt)}</Mono>
                </Meta>
                <Meta label="Attempts">{generation.attempts}</Meta>
                <Meta label="Worker">
                  <Mono>{generation.workerId ?? "—"}</Mono>
                </Meta>
                <Meta label="Id">
                  <Mono>{generation.id}</Mono>
                </Meta>
                <Meta label="Request id">
                  <Mono>{generation.requestId ?? "—"}</Mono>
                </Meta>
              </MetaGroup>
            </CardContent>
          </Card>

          <TimingCard generation={generation} />
        </div>

        {generation.hasOutput ? (
          <PdfFrame
            pdf={generationPdfUrl(generation.id)}
            title={generation.filename}
            className="h-[80svh] lg:h-[calc(100svh-8rem)]"
            toolbar={
              <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                <FilePdfIcon className="size-4 shrink-0" />
                <span className="truncate">{generation.filename}</span>
              </span>
            }
          />
        ) : (
          <EmptyState
            icon={FilePdfIcon}
            title={finished ? "No PDF" : "Not rendered yet"}
            description={
              !finished
                ? "This page refreshes until the render finishes."
                : generation.status === "success"
                  ? "The retention setting removed the PDF. Re-run to render it again."
                  : "The render didn't finish, so there's nothing to preview."
            }
          />
        )}
      </div>

      {generation.signing && generation.hasOutput && (
        <SigningSection
          generationId={generation.id}
          filename={generation.filename}
          signing={generation.signing}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
          {input && (
            <CardAction>
              <CopyButton text={input} label="Copy JSON" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {input ? (
            <>
              {input.includes(`"${MASKED}"`) && (
                <p className="text-sm text-ink-2">
                  This entry belongs to someone else, so sensitive values show as{" "}
                  <code className="font-mono text-xs">{MASKED}</code>.
                </p>
              )}
              <pre className="max-h-[32rem] overflow-auto rounded-lg bg-tint p-3 font-mono text-xs">
                {input}
              </pre>
            </>
          ) : (
            <p className="text-sm text-ink-3">The retention setting removed the input.</p>
          )}
        </CardContent>
      </Card>

      {deleting && (
        <DeleteGenerationDialog
          generation={generation}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate({ to: "/generations" })}
        />
      )}
      {linking && <SignedLinkDialog generation={generation} onClose={() => setLinking(false)} />}
    </Page>
  );
}

type Timed = Pick<Generation, "status" | "queueWaitMs" | "durationMs" | "totalMs" | "timings">;

/** Series slots (index.css) for the phases, skipping the second green. */
const phaseSeries = [1, 2, 3, 4, 5, 7];

/** Where the time went, phase by phase, as a share of queued-to-finished. */
function TimingCard({ generation }: { generation: Timed }) {
  const { timings } = generation;
  const phases = [
    { label: "Queue wait", ms: generation.queueWaitMs },
    { label: "Liquid", ms: timings?.liquidMs ?? null },
    { label: "Chromium (body)", ms: timings?.chromiumMs ?? null },
    { label: "Header and footer bands", ms: timings?.bandsMs ?? null },
    { label: "Stamping", ms: timings?.stampMs ?? null },
    { label: "PDF/A, UA, certify", ms: timings?.finishMs ?? null },
  ].map((phase, i) => ({ ...phase, colour: `var(--series-${phaseSeries[i]})` }));
  const total = generation.totalMs ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timing</CardTitle>
        <CardAction className="font-heading font-extrabold tabular-nums">
          {formatMs(generation.totalMs)}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {total > 0 && (
          <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-tint">
            {phases.map(
              (phase) =>
                (phase.ms ?? 0) > 0 && (
                  <span
                    key={phase.label}
                    style={{
                      width: `${((phase.ms ?? 0) / total) * 100}%`,
                      background: phase.colour,
                    }}
                  />
                ),
            )}
          </div>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {phases.map((phase) => (
            <div key={phase.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: phase.colour }}
              />
              <dt className="text-ink-2">{phase.label}</dt>
              <dd className="ml-auto font-mono text-xs tabular-nums">{formatMs(phase.ms)}</dd>
            </div>
          ))}
        </dl>
        {!timings && generation.durationMs !== null && (
          <p className="text-xs text-ink-3">
            {generation.status === "success"
              ? "No phase breakdown was recorded for this render."
              : "No phase breakdown: the render didn't finish."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** What finishing did (docs/features/archival-accessible-and-certified-output.md). */
function OutputPills({ profile }: { profile: OutputProfile }) {
  const parts = [
    profile.pdfa && `PDF/A-${profile.pdfa}`,
    profile.pdfua && "PDF/UA-1",
    profile.certified && `Certified${profile.certified.timestamped ? ", timestamped" : ""}`,
  ].filter((part) => typeof part === "string");
  if (!parts.length) return <>As rendered (see warnings)</>;
  return (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap gap-1.5">
        {parts.map((part) => (
          <Badge key={part} variant="ok">
            {part}
          </Badge>
        ))}
      </span>
      {profile.certified && (
        <span className="text-xs text-ink-3">By {profile.certified.subject}</span>
      )}
    </span>
  );
}

function MetaGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold text-ink-3">{title}</h3>
      <dl className="divide-y divide-hair">{children}</dl>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("font-mono text-xs break-all", className)}>{children}</span>;
}
