import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert } from "@/components/form";
import { PdfFrame } from "@/components/pdf-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, generationPdfUrl, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { formatBytes } from "@/lib/utils";
import { DeleteGenerationDialog, StatusBadge, sourceLabels, useRerun } from "./-generation-actions";

// Spec: docs/features/generation-log.md
const generationQuery = (id: string) =>
  queryOptions({
    queryKey: ["generations", id],
    queryFn: async () => (await ok(api.generations[":id"].$get({ param: { id } }))).json(),
  });

export const Route = createFileRoute("/_app/generations/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(generationQuery(params.id)),
  component: GenerationDetail,
});

function GenerationDetail() {
  const { id } = Route.useParams();
  const generation = useSuspenseQuery(generationQuery(id)).data;
  const navigate = useNavigate();
  const rerun = useRerun();
  const [deleting, setDeleting] = useState(false);
  const input = JSON.stringify(generation.input, null, 2);

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <Link
        to="/generations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Generations
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold break-all">{generation.filename}</h1>
        <StatusBadge status={generation.status} />
        <div className="ml-auto flex gap-2">
          {generation.hasOutput && (
            <a
              href={generationPdfUrl(generation.id)}
              download={generation.filename}
              className={buttonVariants({ variant: "outline" })}
            >
              <DownloadIcon />
              Download
            </a>
          )}
          <Button
            variant="outline"
            disabled={rerun.isPending}
            onClick={() => rerun.mutate(generation.id)}
          >
            {rerun.isPending ? "Re-running…" : "Re-run"}
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>
      <ErrorAlert error={rerun.error} />

      {generation.error && (
        <Alert variant="destructive">
          <AlertTitle>Render failed</AlertTitle>
          <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
            {generation.error}
          </AlertDescription>
        </Alert>
      )}
      {generation.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {generation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <Meta label="Started">{dayjs(generation.startedAt).format("YYYY-MM-DD HH:mm:ss")}</Meta>
        <Meta label="Duration">{(generation.durationMs / 1000).toFixed(2)} s</Meta>
        <Meta label="Source">{sourceLabels[generation.source]}</Meta>
        <Meta label="User">{generation.userName ?? "Deleted user"}</Meta>
        <Meta label="Pages">{generation.pageCount ?? "—"}</Meta>
        <Meta label="Size">{generation.size === null ? "—" : formatBytes(generation.size)}</Meta>
        <Meta label="Template">
          {generation.templateId ? (
            <span className="font-mono text-xs break-all">{generation.templateId}</span>
          ) : (
            "None (HTML)"
          )}
        </Meta>
        <Meta label="API key">
          {generation.apiKeyId ? (
            <span className="font-mono text-xs break-all">{generation.apiKeyId}</span>
          ) : (
            "None"
          )}
        </Meta>
        {generation.rerunOfId && (
          <Meta label="Re-run of">
            <Link
              to="/generations/$id"
              params={{ id: generation.rerunOfId }}
              className="font-mono text-xs break-all underline"
            >
              {generation.rerunOfId}
            </Link>
          </Meta>
        )}
        <Meta label="Id" wide>
          <span className="font-mono text-xs break-all">{generation.id}</span>
        </Meta>
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Input</h2>
            <CopyButton text={input} label="Copy JSON" />
          </div>
          <pre className="max-h-[70svh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
            {input}
          </pre>
        </section>
        <section className="space-y-2">
          <h2 className="font-medium">Output</h2>
          {generation.hasOutput ? (
            <PdfFrame pdf={generationPdfUrl(generation.id)} title={generation.filename} />
          ) : (
            <p className="text-sm text-muted-foreground">No PDF: the render failed.</p>
          )}
        </section>
      </div>

      {deleting && (
        <DeleteGenerationDialog
          generation={generation}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate({ to: "/generations" })}
        />
      )}
    </main>
  );
}

function Meta({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
