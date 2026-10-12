import {
  stringsFor,
  textDirection,
  translateSections,
  type UpdateSubmission,
} from "@necodoc/shared";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleIcon,
  CloudWarningIcon,
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FileDashedIcon,
  FileMagnifyingGlassIcon,
  PencilSimpleIcon,
  SpinnerGapIcon,
  SwapIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorAlert } from "@/components/form";
import { AnswerSummary, GuidedForm } from "@/components/guided-form";
import { LanguagePicker } from "@/components/language-picker";
import { BackLink, EmptyState, Page, PageHeader } from "@/components/page";
import { PdfFrame, PdfTray } from "@/components/pdf-frame";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, ok, submissionPdfUrl } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { submissionQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { DeleteDocumentDialog, DocumentStatusBadge, useStartDocument } from "./-document-actions";

// Spec: docs/features/filling-out-a-document.md. A draft opens as the interview (autosaved, back
// on its step after a reload); a finished document shows its PDF until reopened for editing.

export const Route = createFileRoute("/_app/documents/$id")({
  component: DocumentPage,
});

type Doc = Awaited<ReturnType<NonNullable<ReturnType<typeof submissionQuery>["queryFn"]>>>;

const isNotFound = (error: Error | null) => error instanceof ApiError && error.status === 404;

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
    // A deleted document or an old link: say so at once instead of retrying.
    retry: (failures, error) => !isNotFound(error) && failures < 3,
  });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = doc.data;

  return (
    <Page width="narrow">
      <BackLink to="/">My documents</BackLink>
      {doc.isPending && (
        <div role="status" aria-busy="true" aria-label="Loading" className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      )}
      {doc.error &&
        (isNotFound(doc.error) ? (
          <EmptyState
            icon={FileMagnifyingGlassIcon}
            title="Document not found"
            description="It may have been deleted, or the link is old."
            action={
              <Button nativeButton={false} render={<Link to="/" />}>
                Back to my documents
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={CloudWarningIcon}
            title="This document couldn't load"
            description={doc.error.message}
            action={
              <Button onClick={() => doc.refetch()}>
                <ArrowClockwiseIcon />
                Try again
              </Button>
            }
          />
        ))}
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
    </Page>
  );
}

/** The document's language and its fields in it (docs/features/document-localization.md). */
function useDocLanguage(doc: Doc) {
  const [lang, setLang] = useState(doc.locale ?? doc.lang);
  const sections = useMemo(
    () => translateSections(doc.sections, stringsFor(doc.translations, lang)),
    [doc.sections, doc.translations, lang],
  );
  return { lang, setLang, sections, dir: textDirection(lang) };
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
  const [icon, text] = {
    saved: [<CheckCircleIcon key="i" />, `Saved ${dayjs(state.at).fromNow()}`],
    pending: [<CircleIcon key="i" weight="bold" className="size-3" />, "Unsaved changes"],
    saving: [<SpinnerGapIcon key="i" weight="bold" className="animate-spin" />, "Saving…"],
    error: [<WarningCircleIcon key="i" />, "Couldn't save; retrying with your next change"],
  }[state.status];
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 [&_svg:not([class*='size-'])]:size-4",
        state.status === "error" ? "font-semibold text-bad" : "text-ink-3",
      )}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
      {text}
    </span>
  );
}

function Interview({ doc, onFinished }: { doc: Doc; onFinished: () => void }) {
  const queryClient = useQueryClient();
  const autosave = useAutosave(doc.id, doc.updatedAt);
  const values = useRef<Record<string, unknown>>(doc.data);
  const language = useDocLanguage(doc);
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
      <header className="space-y-2">
        <h1>
          <Input
            aria-label="Document name"
            defaultValue={doc.name}
            className="-mx-2 h-auto w-[calc(100%+1rem)] border-transparent bg-transparent px-2 py-0.5 font-heading text-[28px] leading-tight font-bold tracking-[-0.025em] hover:bg-tint focus-visible:border-input focus-visible:bg-surface sm:text-[34px] md:text-[34px]"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== doc.name) autosave.queue({ name });
            }}
          />
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <DocumentStatusBadge status="draft" generationStatus={null} />
          <span className="text-ink-2">
            {doc.templateName} · version {doc.version}
          </span>
          <SaveIndicator state={autosave.state} />
          <span className="ms-auto">
            <LanguagePicker
              lang={doc.lang}
              translations={doc.translations}
              value={language.lang}
              onChange={(lang) => {
                language.setLang(lang);
                // Null: the template's own language, so it follows the template.
                autosave.queue({ locale: lang === doc.lang ? null : lang });
              }}
            />
          </span>
        </div>
        {doc.description && <p className="max-w-prose text-[15px] text-ink-2">{doc.description}</p>}
      </header>
      <Card>
        <CardContent dir={language.dir} lang={language.lang} className="sm:px-7 sm:py-2">
          <GuidedForm
            sections={language.sections}
            defaultValues={doc.data}
            initialStep={doc.step}
            review
            submitLabel={finish.isPending ? "Making your PDF…" : "Finish and make PDF"}
            disabled={finish.isPending}
            onChange={(next) => {
              values.current = next;
              autosave.queue({ data: next });
            }}
            onStepChange={(step) => autosave.queue({ step })}
            onSubmit={() => finish.mutate()}
          />
        </CardContent>
      </Card>
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
    onSuccess: () => {
      toast.success("Making a new PDF from your answers");
      return queryClient.invalidateQueries({ queryKey: ["submissions"] });
    },
  });
  const pdfUrl = submissionPdfUrl(doc.id);
  const language = useDocLanguage(doc);
  const busy = regenerate.isPending || rendering(doc);
  const pages =
    doc.pageCount === null ? null : `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={doc.name}
        description={
          <>
            {doc.templateName} · version {doc.version}
            {doc.finishedAt && ` · finished ${dayjs(doc.finishedAt).fromNow()}`}
            {doc.source === "share_link" && (
              <>
                {" · "}through share link{" "}
                {doc.shareLinkLabel ? `“${doc.shareLinkLabel}”` : "(deleted)"}
                {doc.respondentEmail && ` by ${doc.respondentEmail}`}
              </>
            )}
          </>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label="More actions" />}
              >
                <DotsThreeIcon weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuItem disabled={busy} onClick={() => regenerate.mutate()}>
                  <ArrowClockwiseIcon />
                  Regenerate PDF
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate({ templateId: doc.templateId, fromSubmissionId: doc.id })
                  }
                >
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link to="/documents/new" search={{ from: doc.id }} />}>
                  <SwapIcon />
                  Reuse answers in another template
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={onEdit}>
              <PencilSimpleIcon />
              Edit answers
            </Button>
            {doc.generationStatus === "success" && (
              <a href={`${pdfUrl}?download=1`} download className={buttonVariants()}>
                <DownloadSimpleIcon />
                Download PDF
              </a>
            )}
          </>
        }
      >
        <DocumentStatusBadge status={doc.status} generationStatus={doc.generationStatus} />
      </PageHeader>
      <ErrorAlert error={regenerate.error ?? start.error} />

      {rendering(doc) && (
        <PdfTray
          toolbar={
            <span className="inline-flex items-center gap-2 font-semibold">
              <SpinnerGapIcon weight="bold" className="size-4 animate-spin" />
              Making your PDF…
            </span>
          }
        >
          <div className="grid h-80 place-items-center text-sm text-white/80">
            This usually takes a few seconds.
          </div>
        </PdfTray>
      )}
      {doc.generationStatus === "error" && (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>The PDF couldn't be made</AlertTitle>
          <AlertDescription>
            <p>{doc.generationError ?? "Something went wrong while making it."}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => regenerate.mutate()}
            >
              <ArrowClockwiseIcon />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {doc.generationStatus === null && (
        <EmptyState
          icon={FileDashedIcon}
          title="This document's PDF was deleted"
          description="It was removed from the generation log. Your answers are kept, so you can make it again."
          action={
            <Button disabled={busy} onClick={() => regenerate.mutate()}>
              <ArrowClockwiseIcon />
              Make the PDF again
            </Button>
          }
        />
      )}
      {doc.generationStatus === "success" && (
        // The generation id busts the iframe's cache after a regenerate.
        <PdfFrame
          pdf={`${pdfUrl}?g=${doc.generationId}`}
          title={doc.name}
          toolbar={
            <>
              <span className="font-semibold">PDF</span>
              {pages && <span className="text-white/80">{pages}</span>}
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="ms-auto inline-flex items-center gap-1.5 rounded-md font-semibold hover:underline"
              >
                <ArrowSquareOutIcon className="size-4" />
                Open in a new tab
              </a>
            </>
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Answers</h2>
          </CardTitle>
        </CardHeader>
        <CardContent dir={language.dir} lang={language.lang}>
          <AnswerSummary sections={language.sections} values={doc.data} />
        </CardContent>
      </Card>
    </div>
  );
}
