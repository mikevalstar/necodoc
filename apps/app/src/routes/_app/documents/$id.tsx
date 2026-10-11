import type { UpdateSubmission } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorAlert } from "@/components/form";
import { AnswerSummary, GuidedForm } from "@/components/guided-form";
import { PdfFrame } from "@/components/pdf-frame";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ok, submissionPdfUrl } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { submissionQuery } from "@/lib/queries";
import { DeleteDocumentDialog, DocumentStatusBadge, useStartDocument } from "./-document-actions";

// Spec: docs/features/filling-out-a-document.md. A draft opens as the interview (autosaved, back
// on its step after a reload); a finished document shows its PDF until reopened for editing.

export const Route = createFileRoute("/_app/documents/$id")({
  component: DocumentPage,
});

type Doc = Awaited<ReturnType<NonNullable<ReturnType<typeof submissionQuery>["queryFn"]>>>;

const rendering = (doc: Doc | undefined) =>
  doc?.status === "finished" &&
  (doc.generationStatus === "queued" || doc.generationStatus === "running");

function DocumentPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const doc = useQuery({
    ...submissionQuery(id),
    // Poll while the PDF is being made.
    refetchInterval: (query) => (rendering(query.state.data) ? 1500 : false),
  });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = doc.data;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        My documents
      </Link>
      <ErrorAlert error={doc.error} />
      {data &&
        (data.status === "draft" || editing ? (
          <Interview key={data.id} doc={data} onFinished={() => setEditing(false)} />
        ) : (
          <Finished doc={data} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} />
        ))}
      {data && deleting && (
        <DeleteDocumentDialog
          document={data}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate({ to: "/" })}
        />
      )}
    </main>
  );
}

type SaveState = { status: "saved" | "pending" | "saving" | "error"; at: string };

/**
 * Debounced PATCHes, sent one after another so they land in order. Whatever is still waiting
 * goes out with keepalive when the page is hidden or closed, and on unmount.
 */
function useAutosave(id: string, savedAt: string) {
  const queryClient = useQueryClient();
  const waiting = useRef<UpdateSubmission | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [state, setState] = useState<SaveState>({ status: "saved", at: savedAt });

  const flush = useCallback(
    (keepalive = false) => {
      clearTimeout(timer.current);
      const json = waiting.current;
      waiting.current = null;
      if (json) {
        chain.current = chain.current.then(async () => {
          setState((s) => ({ ...s, status: "saving" }));
          try {
            const res = await ok(
              api.submissions[":id"].$patch({ param: { id }, json }, { init: { keepalive } }),
            );
            const { updatedAt } = await res.json();
            setState({ status: waiting.current ? "pending" : "saved", at: updatedAt });
          } catch {
            // Put it back for the next change or flush to retry, unless newer changes replaced it.
            waiting.current = { ...json, ...waiting.current };
            setState((s) => ({ ...s, status: "error" }));
          }
        });
      }
      return chain.current;
    },
    [id],
  );

  const queue = useCallback(
    (changes: UpdateSubmission) => {
      waiting.current = { ...waiting.current, ...changes };
      setState((s) => ({ ...s, status: "pending" }));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => void flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush(true).then(() => queryClient.invalidateQueries({ queryKey: ["submissions"] }));
    };
  }, [flush, queryClient]);

  return { queue, flush, state };
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = {
    saved: `Saved ${dayjs(state.at).fromNow()}`,
    pending: "Unsaved changes",
    saving: "Saving…",
    error: "Couldn't save; retrying with your next change",
  }[state.status];
  return (
    <span
      role="status"
      className={state.status === "error" ? "text-destructive" : "text-muted-foreground"}
    >
      {text}
    </span>
  );
}

function Interview({ doc, onFinished }: { doc: Doc; onFinished: () => void }) {
  const queryClient = useQueryClient();
  const autosave = useAutosave(doc.id, doc.updatedAt);
  const values = useRef<Record<string, unknown>>(doc.data);
  // Re-render the "Saved 2 minutes ago" text now and then.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const finish = useMutation({
    mutationFn: async () => {
      await autosave.flush();
      return ok(
        api.submissions[":id"].finish.$post({
          param: { id: doc.id },
          json: { data: values.current },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["submissions"] });
      onFinished();
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Input
          aria-label="Document name"
          defaultValue={doc.name}
          className="h-auto border-transparent px-0 text-2xl font-semibold shadow-none hover:border-input focus-visible:px-2 md:text-2xl"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== doc.name) autosave.queue({ name });
          }}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            {doc.templateName} · version {doc.version}
          </span>
          <Badge variant="outline">Draft</Badge>
          <SaveIndicator state={autosave.state} />
        </div>
        {doc.description && <p className="text-sm text-muted-foreground">{doc.description}</p>}
      </div>
      <GuidedForm
        sections={doc.sections}
        defaultValues={doc.data}
        initialStep={doc.step}
        review
        submitLabel={finish.isPending ? "Finishing…" : "Finish and make PDF"}
        disabled={finish.isPending}
        onChange={(next) => {
          values.current = next;
          autosave.queue({ data: next });
        }}
        onStepChange={(step) => autosave.queue({ step })}
        onSubmit={() => finish.mutate()}
      />
      <ErrorAlert error={finish.error} />
    </div>
  );
}

function Finished({
  doc,
  onEdit,
  onDelete,
}: {
  doc: Doc;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const start = useStartDocument();
  const regenerate = useMutation({
    mutationFn: () => ok(api.submissions[":id"].finish.$post({ param: { id: doc.id }, json: {} })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["submissions"] }),
  });
  const pdfUrl = submissionPdfUrl(doc.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold break-words">{doc.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {doc.templateName} · version {doc.version}
          </span>
          <DocumentStatusBadge status={doc.status} generationStatus={doc.generationStatus} />
          {doc.finishedAt && <span>Finished {dayjs(doc.finishedAt).fromNow()}</span>}
          {doc.source === "share_link" && (
            <span>
              Through share link {doc.shareLinkLabel ? `“${doc.shareLinkLabel}”` : "(deleted)"}
              {doc.respondentEmail && ` by ${doc.respondentEmail}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {doc.generationStatus === "success" && (
          <a
            href={`${pdfUrl}?download=1`}
            download
            className={buttonVariants({ variant: "default" })}
          >
            <DownloadIcon />
            Download PDF
          </a>
        )}
        <Button variant="outline" onClick={onEdit}>
          Edit answers
        </Button>
        <Button
          variant="outline"
          disabled={regenerate.isPending || rendering(doc)}
          onClick={() => regenerate.mutate()}
        >
          Regenerate
        </Button>
        <Button
          variant="outline"
          disabled={start.isPending}
          onClick={() => start.mutate({ templateId: doc.templateId, fromSubmissionId: doc.id })}
        >
          Duplicate
        </Button>
        <Button variant="outline" className="text-destructive" onClick={onDelete}>
          Delete
        </Button>
      </div>
      <ErrorAlert error={regenerate.error ?? start.error} />

      {rendering(doc) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Making your PDF…
        </p>
      )}
      {doc.generationStatus === "error" && (
        <ErrorAlert error={new Error(doc.generationError ?? "The PDF couldn't be made")} />
      )}
      {doc.generationStatus === null && (
        <p className="text-sm text-muted-foreground">
          This document's PDF was deleted from the generation log. Regenerate to make it again.
        </p>
      )}
      {doc.generationStatus === "success" && (
        // The generation id busts the iframe's cache after a regenerate.
        <PdfFrame pdf={`${pdfUrl}?g=${doc.generationId}`} title={doc.name} />
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Answers</h2>
        <AnswerSummary sections={doc.sections} values={doc.data} />
      </section>
    </div>
  );
}
