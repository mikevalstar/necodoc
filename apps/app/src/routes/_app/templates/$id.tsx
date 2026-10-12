import {
  type DesignedDraft,
  designedContentSchema,
  hasPermission,
  overlayFieldProblems,
  type Template,
  TemplateCompileError,
  templateFieldProblems,
  templateSchema,
  toCodeMode,
} from "@necodoc/shared";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  DotsThreeIcon,
  EyeIcon,
  RocketLaunchIcon,
  SparkleIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useBlocker, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { useAiEnabled } from "@/components/ai";
import { HistoryPanel } from "@/components/audit";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page } from "@/components/page";
import { PdfFrame, PdfTray, usePdfPreview } from "@/components/pdf-frame";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, ok, previewTemplate } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { snippetsQuery, templatesQuery } from "@/lib/queries";
import { useSaveShortcut } from "@/lib/save-shortcut";
import { cn } from "@/lib/utils";
import { AssistantPanel } from "./-assistant";
import { BandsPanel, BodyPanel, CssPanel } from "./-content-panels";
import {
  type CommonChanges,
  type DesignedDraftValues,
  type DraftValues,
  draftSchema,
  type EditorContent,
  mergeApplied,
  previewDraftSchema,
  problemArea,
  templateQuery,
  toDraftValues,
} from "./-draft";
import { FieldDesigner } from "./-field-designer";
import { OutputPanel } from "./-output-panel";
import { OverlayEditor, OverlayPdfPanel } from "./-overlay-editor";
import { PagePanel } from "./-page-panel";
import { ReviewStatusBadge, ReviewsPanel, reviewStateQuery, SubmitReviewDialog } from "./-review";
import { SamplePanel } from "./-sample-panel";
import { SigningPanel } from "./-signing-panel";
import {
  DeleteTemplateDialog,
  PublishDialog,
  TemplateStatusBadges,
  useArchiveTemplate,
  useDuplicateTemplate,
} from "./-template-actions";
import { TestsPanel } from "./-tests";
import { TranslationsPanel } from "./-translations-panel";
import { VersionsPanel, versionQuery, versionsQuery } from "./-versions";

// Specs: docs/features/document-templates.md, docs/features/pdf-overlay-templates.md,
// docs/features/template-fields-and-guided-form.md, docs/features/publishing-and-versions.md. Editors change the draft; reviewers and publishers
// open it read-only; viewers never get here (the API refuses them the draft).

export const Route = createFileRoute("/_app/templates/$id")({
  staticData: { railSidebar: true },
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const seesDrafts = (["edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!seesDrafts) throw redirect({ to: "/templates" });
  },
  // `build`: a description from the new-template dialog for the AI assistant to build from.
  validateSearch: z.object({ build: z.string().max(4000).optional() }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(templateQuery(params.id)),
  component: TemplatePage,
});

type TabValue =
  | "content"
  | "bands"
  | "fields"
  | "sample"
  | "signing"
  | "output"
  | "translations"
  | "page"
  | "css"
  | "tests"
  | "reviews"
  | "versions";

/** The tab where a draft problem's path is fixed; null for the name in the header. */
function issueTab(path: readonly PropertyKey[]): TabValue | null {
  const [first, second] = path;
  if (first === "name") return null;
  if (first === "sections") return "fields";
  if (first === "sampleData") return "sample";
  if (first === "page" || first === "themeId" || first === "description") return "page";
  if (first !== "content") return "content";
  if (second === "header" || second === "footer") return "bands";
  if (second === "signers") return "signing";
  if (second === "output") return "output";
  if (second === "translations") return "translations";
  if (second === "css") return "css";
  return "content";
}

function TemplatePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const template = useSuspenseQuery(templateQuery(id)).data;
  /** Bumped to throw the editor's state away and load the stored draft (reload, restore). */
  const [loads, setLoads] = useState(0);
  const reload = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: templateQuery(id).queryKey, exact: true });
    setLoads((n) => n + 1);
  }, [id, queryClient]);
  return <TemplateEditor key={`${template.id}:${loads}`} template={template} onReload={reload} />;
}

function TemplateEditor({
  template,
  onReload,
}: {
  template: Template;
  onReload: () => Promise<void>;
}) {
  const { me } = Route.useRouteContext();
  const can = (action: "create" | "edit" | "publish") =>
    hasPermission(me.user.roles, { document: [action] });
  const canEdit = can("edit");
  const queryClient = useQueryClient();
  const duplicate = useDuplicateTemplate();
  const navigate = useNavigate();
  const archive = useArchiveTemplate();
  // Polled: someone may publish or review this template elsewhere, and the badges and the
  // Publish button must not go stale.
  const versions = useQuery({ ...versionsQuery(template.id), refetchInterval: 30_000 });
  const review = useQuery({ ...reviewStateQuery(template.id), refetchInterval: 30_000 }).data;

  const [draft, setDraft] = useState<DraftValues>(() => toDraftValues(template));
  const [saved, setSaved] = useState(() => JSON.stringify(toDraftValues(template)));
  /** The draft's updatedAt when this editor loaded or last saved it: the 409 guard. */
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(template.updatedAt);
  const [archivedAt, setArchivedAt] = useState(template.archivedAt);
  const [dialog, setDialog] = useState<"publish" | "review" | "delete" | "code" | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const change = (changes: CommonChanges) => setDraft((d) => ({ ...d, ...changes }));
  const changeDesigned = (changes: Partial<DesignedDraftValues>) =>
    setDraft((d) => (d.kind === "designed" ? { ...d, ...changes } : d));
  const setContent = (content: EditorContent) => changeDesigned({ content });
  const current = JSON.stringify(draft);
  const dirty = canEdit && current !== saved;

  const parsed = useMemo(() => draftSchema.safeParse(draft), [draft]);
  const snippets = useQuery(snippetsQuery).data;
  const problems = useMemo(() => {
    const found =
      draft.kind === "overlay"
        ? overlayFieldProblems(draft.content, draft.sections)
        : (() => {
            const content = designedContentSchema.safeParse(draft.content);
            return content.success
              ? templateFieldProblems(content.data, draft.sections, snippets)
              : [];
          })();
    // One line per distinct problem, however many places it occurs.
    return [...new Set(found.map((p) => p.message))];
  }, [draft, snippets]);

  // AI (docs/features/ai-template-assistant.md): only when the API has a key and the user edits.
  const aiEnabled = useAiEnabled() && canEdit;
  const { build } = Route.useSearch();
  const assistantAvailable = aiEnabled && draft.kind === "designed";
  /** null until first opened; closing hides the panel but keeps the conversation. */
  const [assistantOpen, setAssistantOpen] = useState<boolean | null>(build ? true : null);
  /** An unapplied proposal the preview shows instead of the draft. */
  const [proposal, setProposal] = useState<{ id: string; draft: DesignedDraft } | null>(null);
  // Sent once: drop it from the URL so a reload doesn't ask again.
  const clearBuild = useCallback(
    () =>
      navigate({
        to: "/templates/$id",
        params: { id: template.id },
        search: {},
        replace: true,
        ignoreBlocker: true,
      }),
    [navigate, template.id],
  );
  const suggestDescription = aiEnabled
    ? async () => {
        if (!parsed.success) throw new Error("Fix the problems listed above first.");
        const res = await ok(
          api.templates[":id"].ai.description.$post({
            param: { id: template.id },
            json: { draft: parsed.data },
          }),
        );
        return (await res.json()).text;
      }
    : undefined;

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.success) throw new Error("Fix the problems listed above first.");
      const sent = current;
      const row = await (
        await ok(
          api.templates[":id"].$patch({
            param: { id: template.id },
            json: { ...parsed.data, baseUpdatedAt },
          }),
        )
      ).json();
      return { row, sent };
    },
    onSuccess: async ({ row, sent }) => {
      setBaseUpdatedAt(row.updatedAt);
      setSaved(sent);
      queryClient.setQueryData(templateQuery(template.id).queryKey, templateSchema.parse(row));
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey, exact: true });
      // An open review may have gone stale.
      await queryClient.invalidateQueries({ queryKey: reviewStateQuery(template.id).queryKey });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  useSaveShortcut(dirty && !save.isPending && parsed.success, save.mutate);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const version = useQuery({
    ...versionQuery(template.id, previewing ?? 0),
    enabled: previewing !== null,
  });
  /** Preview in one of the template's translations instead of its own language (ADR 0040). */
  const [previewLang, setPreviewLang] = useState<string | null>(null);
  const previewLanguages = [draft.content.output.lang, ...Object.keys(draft.content.translations)];
  const previewRequest = useMemo(() => {
    const source = proposal ? proposal.draft : previewing === null ? draft : version.data;
    if (!source) return null;
    const result = previewDraftSchema.safeParse(source);
    if (!result.success) return null;
    const parsed = result.data;
    if (previewLang && previewLang !== parsed.content.output.lang) {
      parsed.content = {
        ...parsed.content,
        output: { ...parsed.content.output, lang: previewLang },
      };
    }
    return { id: template.id, draft: parsed };
  }, [draft, previewing, version.data, template.id, proposal, previewLang]);
  const preview = usePdfPreview(previewRequest, previewTemplate);

  const latest = versions.data?.[0];
  const status = {
    archivedAt,
    latestVersion: latest?.version ?? null,
    hasUnpublishedChanges: !latest || dayjs(baseUpdatedAt).isAfter(latest.publishedAt) || dirty,
  };
  // The API's review gate (docs/features/review-and-approval.md), so Publish isn't offered
  // only to be refused.
  const needsApproval = !!review?.settings.requireReview && !review.approved;

  /** The draft's content compiled to code mode, or null with the reason shown in the dialog. */
  const codeContent = () => {
    if (draft.kind !== "designed") return null;
    const content = designedContentSchema.safeParse(draft.content);
    if (!content.success) {
      setCodeError("Fix the content problems first.");
      return null;
    }
    try {
      return toCodeMode(content.data, draft.sections);
    } catch (error) {
      if (!(error instanceof TemplateCompileError)) throw error;
      setCodeError(error.message);
      return null;
    }
  };
  const convertToCode = () => {
    const code = codeContent();
    if (!code) return;
    setContent(code);
    setCodeError(null);
    setDialog(null);
  };
  const duplicateAsCode = useMutation({
    mutationFn: async () => {
      const content = codeContent();
      if (!content || !parsed.success || parsed.data.kind !== "designed") {
        throw new Error("Fix the problems first.");
      }
      const json = { ...parsed.data, name: `${draft.name} (code)`, content };
      return (await ok(api.templates.$post({ json }))).json();
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });
      setDialog(null);
      // The visual original keeps its unsaved edits only if the user stays; the guard asks.
      await navigate({ to: "/templates/$id", params: { id: created.id } });
    },
  });

  const issues = parsed.success ? [] : parsed.error.issues.slice(0, 6);
  /** Problems per tab, so the tab to fix says so. */
  const tabIssues = new Map<TabValue, number>();
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const tab = issueTab(issue.path);
    if (tab) tabIssues.set(tab, (tabIssues.get(tab) ?? 0) + 1);
  }
  const fieldCount = draft.sections.reduce((n, s) => n + s.fields.length, 0);
  const designed = draft.kind === "designed";
  const tabs: { value: TabValue; label: string; count?: number }[] = [
    { value: "content", label: designed ? "Content" : "Boxes" },
    ...(designed ? [{ value: "bands" as const, label: "Header & footer" }] : []),
    { value: "fields", label: "Fields", count: fieldCount },
    { value: "sample", label: "Sample data" },
    { value: "signing", label: "Signing" },
    { value: "output", label: "Output" },
    { value: "translations", label: "Translations" },
    { value: "page", label: designed ? "Page & theme" : "PDF" },
    ...(designed ? [{ value: "css" as const, label: "CSS" }] : []),
    { value: "tests", label: "Tests" },
    { value: "reviews", label: "Reviews" },
    { value: "versions", label: "Versions" },
  ];
  /** Form-like tabs sit on a card; the editors and canvases bring their own surface. */
  const panel = "rounded-xl bg-card p-5 shadow-card";
  const previewHeight = assistantOpen ? "h-[40svh]" : "h-[calc(100svh-9rem)] min-h-[32rem]";
  const canPublishNow = !dirty && !archivedAt && status.hasUnpublishedChanges && !needsApproval;
  const nextVersion = versions.data ? (latest?.version ?? 0) + 1 : null;

  const previewToolbar = (
    <>
      <span className="inline-flex items-center gap-2 font-bold">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full bg-white ring-3 ring-white/25",
            preview.isFetching && "animate-pulse",
          )}
        />
        {proposal
          ? "Proposed change"
          : previewing === null
            ? "Live preview"
            : `Version ${previewing}`}
      </span>
      {preview.data && (
        <span className="text-white/80">
          {preview.data.pageCount} {preview.data.pageCount === 1 ? "page" : "pages"}
        </span>
      )}
      {previewLanguages.length > 1 && (
        <NativeSelect
          size="sm"
          aria-label="Preview language"
          value={previewLang ?? previewLanguages[0]}
          onChange={(e) => setPreviewLang(e.target.value)}
        >
          {previewLanguages.map((lang) => (
            <NativeSelectOption key={lang} value={lang}>
              {lang}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      {preview.data && !preview.data.dataValid && previewing === null && (
        <Badge variant="warn">Sample data doesn't fit the fields</Badge>
      )}
      <span className="ml-auto flex items-center gap-2">
        <span role="status" className="text-white/80">
          {preview.isFetching
            ? "Rendering…"
            : previewRequest
              ? "Up to date"
              : "Fix the problems to preview"}
        </span>
        {previewing !== null && (
          <Button variant="outline" size="xs" onClick={() => setPreviewing(null)}>
            Back to draft
          </Button>
        )}
      </span>
    </>
  );

  return (
    <Page width="wide" className="space-y-4 pt-1 pb-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 shrink-0"
          aria-label="Back to templates"
          title="Templates"
          nativeButton={false}
          render={<Link to="/templates" />}
        >
          <ArrowLeftIcon weight="bold" />
        </Button>
        {/* Title, pills and save state wrap among themselves so the actions don't jump. */}
        <div className="flex min-w-[min(100%,20rem)] flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <Input
            aria-label="Template name"
            className="h-11 w-auto max-w-full min-w-48 border-transparent bg-transparent px-2 font-heading text-[26px] font-bold tracking-[-0.02em] field-sizing-content hover:border-input focus:bg-surface md:text-[26px]"
            value={draft.name}
            readOnly={!canEdit}
            onChange={(e) => change({ name: e.target.value })}
          />
          <TemplateStatusBadges template={status} />
          {draft.kind === "designed" && draft.content.mode === "code" && (
            <Badge variant="secondary">Code mode</Badge>
          )}
          {draft.kind === "overlay" && <Badge variant="secondary">PDF overlay</Badge>}
          {review?.current && (
            <ReviewStatusBadge status={review.current.status} stale={review.current.stale} />
          )}
          {canEdit && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-ink-3"
            >
              {dirty ? (
                <CloudArrowUpIcon className="size-4" />
              ) : (
                <CloudCheckIcon className="size-4" />
              )}
              {save.isPending
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : `Saved ${dayjs(baseUpdatedAt).fromNow()}`}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {assistantAvailable && !assistantOpen && (
            <Button variant="outline" onClick={() => setAssistantOpen(true)}>
              <SparkleIcon />
              Assistant
            </Button>
          )}
          {canEdit && (
            <Button
              variant={dirty ? "default" : "outline"}
              disabled={!dirty || save.isPending || !parsed.success}
              title={parsed.success ? "Save (⌘S)" : "Fix the problems first"}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              disabled={dirty || !!archivedAt}
              title={dirty ? "Save your changes first" : undefined}
              onClick={() => setDialog("review")}
            >
              {review?.current ? "Resubmit for review" : "Submit for review"}
            </Button>
          )}
          {can("publish") && (
            <Button
              variant={canPublishNow ? "default" : "outline"}
              disabled={!canPublishNow}
              title={
                dirty
                  ? "Save your changes first"
                  : archivedAt
                    ? "Restore it first"
                    : !status.hasUnpublishedChanges
                      ? `Nothing changed since version ${latest?.version}`
                      : needsApproval
                        ? "Publishing needs an approved review of this draft: submit it for review first"
                        : undefined
              }
              onClick={() => setDialog("publish")}
            >
              <RocketLaunchIcon />
              {nextVersion ? `Publish v${nextVersion}` : "Publish"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label="More actions" />}
            >
              <DotsThreeIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {can("create") && (
                <DropdownMenuItem disabled={dirty} onClick={() => duplicate.mutate(template.id)}>
                  Duplicate{dirty ? " (save first)" : ""}
                </DropdownMenuItem>
              )}
              {can("publish") && (
                <DropdownMenuItem
                  onClick={() =>
                    archive.mutate(
                      { id: template.id, archive: !archivedAt },
                      { onSuccess: (row) => setArchivedAt(row.archivedAt) },
                    )
                  }
                >
                  {archivedAt ? "Restore" : "Archive"}
                </DropdownMenuItem>
              )}
              {(canEdit || can("create")) &&
                draft.kind === "designed" &&
                draft.content.mode === "visual" && (
                  <DropdownMenuItem onClick={() => setDialog("code")}>Code mode…</DropdownMenuItem>
                )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                    Delete…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!canEdit && (
        <Alert>
          <EyeIcon />
          <AlertDescription>
            You can review this draft and its preview, but not change it.
          </AlertDescription>
        </Alert>
      )}
      {archivedAt && (
        <Alert>
          <ArchiveIcon />
          <AlertDescription>
            Archived {dayjs(archivedAt).fromNow()}: hidden from filling and the API. Its versions
            stay for history and re-runs.
          </AlertDescription>
        </Alert>
      )}
      {can("publish") && needsApproval && status.hasUnpublishedChanges && !dirty && !archivedAt && (
        <p className="text-sm text-ink-3">
          Publishing needs an approved review of this exact draft.{" "}
          {review?.current
            ? review.current.stale
              ? "The draft changed since the review: resubmit it."
              : "The review isn't approved yet."
            : "Submit it for review first."}
        </p>
      )}
      {conflict ? (
        <Alert variant="destructive">
          <AlertTitle>Someone saved this draft since you opened it</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Saving now would overwrite their changes. Reload to get their version; your unsaved
              changes here will be lost, so copy anything you need first.
            </p>
            <Button variant="outline" size="sm" onClick={() => onReload()}>
              Reload the draft
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <ErrorAlert error={save.error ?? duplicate.error ?? archive.error} />
      )}
      {canEdit && issues.length > 0 && (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Can't save or preview yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {issues.map((issue) => (
                <li key={`${issue.path.join(".")}:${issue.message}`}>
                  {problemArea(issue.path)}: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {problems.length > 0 && (
        <Alert className="bg-warn-wash *:[svg]:text-warn">
          <WarningIcon />
          <AlertTitle>Field references to check</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="content" className="gap-4">
        <div className="flex items-center gap-3">
          {/* One row: scrolls sideways (fading at the edge) when the window is too narrow for every tab. */}
          <TabsList
            aria-label="Template sections"
            className="max-w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none] *:data-[slot=tabs-trigger]:flex-none max-xl:pr-10 max-xl:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]"
          >
            {tabs.map((tab) => {
              const bad = tabIssues.get(tab.value);
              return (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="rounded-full bg-tint-2 px-1.5 text-[11px] tabular-nums">
                      {tab.count}
                    </span>
                  )}
                  {bad && (
                    <span className="rounded-full bg-bad-wash px-1.5 text-[11px] text-bad tabular-nums">
                      {bad}
                      <span className="sr-only"> {bad === 1 ? "problem" : "problems"}</span>
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <FaqLink
            className="ml-auto shrink-0"
            feature={draft.kind === "overlay" ? "PDF overlay templates" : "Designed templates"}
          />
        </div>

        <div
          className={
            draft.kind === "overlay"
              ? "grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)]"
              : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
          }
        >
          <div className="min-w-0">
            {draft.kind === "overlay" ? (
              <>
                {/* Kept mounted: the PDF stays loaded and rendered across tab switches. */}
                <TabsContent value="content" keepMounted>
                  <OverlayEditor
                    content={draft.content}
                    sections={draft.sections}
                    editable={canEdit}
                    onChange={(changes) =>
                      setDraft((d) =>
                        d.kind === "overlay"
                          ? {
                              ...d,
                              content: changes.content ?? d.content,
                              sections: changes.sections ?? d.sections,
                            }
                          : d,
                      )
                    }
                  />
                </TabsContent>
                <TabsContent value="page">
                  <OverlayPdfPanel
                    description={draft.description}
                    content={draft.content}
                    editable={canEdit}
                    onDescription={(description) => change({ description })}
                    suggestDescription={suggestDescription}
                    onContent={(content) =>
                      setDraft((d) => (d.kind === "overlay" ? { ...d, content } : d))
                    }
                  />
                </TabsContent>
              </>
            ) : (
              <>
                {/* Editors stay mounted so their undo history and cursor survive tab switches. */}
                <TabsContent
                  value="content"
                  keepMounted
                  className={draft.content.mode === "code" ? panel : undefined}
                >
                  <BodyPanel
                    content={draft.content}
                    onChange={setContent}
                    sections={draft.sections}
                    editable={canEdit}
                  />
                </TabsContent>
                <TabsContent value="bands" keepMounted className={panel}>
                  <BandsPanel
                    content={draft.content}
                    onChange={setContent}
                    sections={draft.sections}
                    editable={canEdit}
                  />
                </TabsContent>
                <TabsContent value="page" className={panel}>
                  <PagePanel
                    draft={draft}
                    onChange={changeDesigned}
                    editable={canEdit}
                    suggestDescription={suggestDescription}
                  />
                </TabsContent>
                <TabsContent value="css" keepMounted className={panel}>
                  <CssPanel content={draft.content} onChange={setContent} editable={canEdit} />
                </TabsContent>
              </>
            )}
            <TabsContent value="fields" className={panel}>
              <FieldDesigner
                sections={draft.sections}
                onChange={(sections) => change({ sections })}
                disabled={!canEdit}
              />
            </TabsContent>
            <TabsContent value="sample" className={panel}>
              <SamplePanel
                sections={draft.sections}
                sampleData={draft.sampleData}
                onChange={(sampleData) => change({ sampleData })}
                editable={canEdit}
              />
            </TabsContent>
            <TabsContent value="signing" className={panel}>
              <SigningPanel
                signers={draft.content.signers}
                kind={draft.kind}
                editable={canEdit}
                onChange={(signers) =>
                  setDraft((d) =>
                    d.kind === "overlay"
                      ? { ...d, content: { ...d.content, signers } }
                      : { ...d, content: { ...d.content, signers } },
                  )
                }
              />
            </TabsContent>
            <TabsContent value="output" className={panel}>
              <OutputPanel
                output={draft.content.output}
                kind={draft.kind}
                editable={canEdit}
                onChange={(output) =>
                  setDraft((d) =>
                    d.kind === "overlay"
                      ? { ...d, content: { ...d.content, output } }
                      : { ...d, content: { ...d.content, output } },
                  )
                }
              />
            </TabsContent>
            <TabsContent value="translations" className={panel}>
              <TranslationsPanel
                translations={draft.content.translations}
                lang={draft.content.output.lang}
                sections={draft.sections}
                content={draft.content}
                editable={canEdit}
                onChange={(translations) =>
                  setDraft((d) =>
                    d.kind === "overlay"
                      ? { ...d, content: { ...d.content, translations } }
                      : { ...d, content: { ...d.content, translations } },
                  )
                }
              />
            </TabsContent>
            <TabsContent value="tests" className={panel}>
              <TestsPanel
                id={template.id}
                draftUpdatedAt={baseUpdatedAt}
                canEdit={canEdit}
                dirty={dirty}
              />
            </TabsContent>
            <TabsContent value="reviews" className={panel}>
              <ReviewsPanel templateId={template.id} canEdit={canEdit} dirty={dirty} />
            </TabsContent>
            <TabsContent value="versions" className={panel}>
              <VersionsPanel
                id={template.id}
                canEdit={canEdit}
                canPublish={can("publish")}
                dirty={dirty}
                previewing={previewing}
                onPreview={setPreviewing}
                onRestored={() => onReload()}
              />
            </TabsContent>
          </div>

          <div className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:self-start">
            {assistantAvailable && assistantOpen !== null && draft.kind === "designed" && (
              <div hidden={!assistantOpen}>
                <AssistantPanel
                  templateId={template.id}
                  draft={draft}
                  build={build}
                  onBuildSent={clearBuild}
                  onApply={(next, parts) => setDraft((d) => mergeApplied(d, next, parts))}
                  previewing={proposal?.id ?? null}
                  onPreview={setProposal}
                  onClose={() => {
                    setAssistantOpen(false);
                    setProposal(null);
                  }}
                />
              </div>
            )}
            <ErrorAlert error={preview.error ?? version.error} />
            {preview.data && preview.data.warnings.length > 0 && (
              <Alert className="bg-warn-wash *:[svg]:text-warn">
                <WarningIcon />
                <AlertTitle>Render warnings</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {preview.data.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {preview.data ? (
              <PdfFrame
                pdf={preview.data.pdf}
                title="Template preview"
                toolbar={previewToolbar}
                className={previewHeight}
              />
            ) : (
              <PdfTray toolbar={previewToolbar}>
                <div className={cn("grid place-items-center text-sm text-white/80", previewHeight)}>
                  {preview.error ? "The preview couldn't render." : "Rendering preview…"}
                </div>
              </PdfTray>
            )}
          </div>
        </div>
      </Tabs>

      {dialog === "publish" && (
        <PublishDialog
          template={{
            id: template.id,
            name: draft.name,
            latestVersion: latest?.version ?? null,
            updatedAt: baseUpdatedAt,
          }}
          onClose={() => setDialog(null)}
          onPublished={() => setDialog(null)}
        />
      )}
      {dialog === "review" && (
        <SubmitReviewDialog
          templateId={template.id}
          resubmit={!!review?.current}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <DeleteTemplateDialog
          template={{ id: template.id, name: draft.name }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "code" && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent className="sm:max-w-lg!">
            <AlertDialogHeader>
              <AlertDialogTitle>Switch to code mode?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  The body, header and footer are compiled to HTML and Liquid that you edit by hand
                  in a code editor. The PDF stays the same.
                </span>
                <span className="block font-medium text-foreground">
                  It's one way. Once saved, this template can't go back to the visual editor:
                  arbitrary HTML doesn't map onto its blocks.
                </span>
                <span className="block">
                  To keep the visual original, duplicate it as a separate code template instead. For
                  a few advanced bits, a Raw HTML / Liquid block (Insert menu) avoids switching at
                  all. Published versions aren't affected either way.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {codeError && (
              <Alert variant="destructive">
                <AlertDescription>{codeError}</AlertDescription>
              </Alert>
            )}
            <ErrorAlert error={duplicateAsCode.error} />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {can("create") && (
                <Button
                  variant="outline"
                  disabled={duplicateAsCode.isPending}
                  onClick={() => duplicateAsCode.mutate()}
                >
                  Duplicate as code template
                </Button>
              )}
              {canEdit && (
                <AlertDialogAction variant="destructive" onClick={convertToCode}>
                  Convert this template
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {blocker.status === "blocked" && (
        <AlertDialog open onOpenChange={(open) => !open && blocker.reset()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
              <AlertDialogDescription>
                Your unsaved changes to this draft are lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => blocker.reset()}>Stay</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => blocker.proceed()}>
                Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <HistoryPanel targetType="template" targetId={template.id} />
    </Page>
  );
}
