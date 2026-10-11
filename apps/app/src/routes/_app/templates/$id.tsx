import {
  designedContentSchema,
  hasPermission,
  overlayFieldProblems,
  type Template,
  TemplateCompileError,
  templateFieldProblems,
  templateSchema,
  toCodeMode,
} from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useBlocker, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, MoreHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HistoryPanel } from "@/components/audit";
import { ErrorAlert } from "@/components/form";
import { PdfFrame, usePdfPreview } from "@/components/pdf-frame";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, ok, previewTemplate } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { snippetsQuery, templatesQuery } from "@/lib/queries";
import { BandsPanel, BodyPanel, CssPanel } from "./-content-panels";
import {
  type CommonChanges,
  type DesignedDraftValues,
  type DraftValues,
  draftSchema,
  type EditorContent,
  previewDraftSchema,
  problemArea,
  templateQuery,
  toDraftValues,
} from "./-draft";
import { FieldDesigner } from "./-field-designer";
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
import { VersionsPanel, versionQuery, versionsQuery } from "./-versions";

// Specs: docs/features/document-templates.md, docs/features/pdf-overlay-templates.md,
// docs/features/template-fields-and-guided-form.md, docs/features/publishing-and-versions.md. Editors change the draft; reviewers and publishers
// open it read-only; viewers never get here (the API refuses them the draft).

export const Route = createFileRoute("/_app/templates/$id")({
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const seesDrafts = (["edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!seesDrafts) throw redirect({ to: "/templates" });
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(templateQuery(params.id)),
  component: TemplatePage,
});

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
  const versions = useQuery(versionsQuery(template.id));
  const review = useQuery(reviewStateQuery(template.id)).data;

  const [draft, setDraft] = useState<DraftValues>(() => toDraftValues(template));
  const [saved, setSaved] = useState(() => JSON.stringify(toDraftValues(template)));
  /** The draft's updatedAt when this editor loaded or last saved it: the 409 guard. */
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(template.updatedAt);
  const [archivedAt, setArchivedAt] = useState(template.archivedAt);
  const [dialog, setDialog] = useState<"publish" | "review" | "delete" | "code" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  // ⌘/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const version = useQuery({
    ...versionQuery(template.id, previewing ?? 0),
    enabled: previewing !== null,
  });
  const previewRequest = useMemo(() => {
    const source = previewing === null ? draft : version.data;
    if (!source) return null;
    const result = previewDraftSchema.safeParse(source);
    return result.success ? { id: template.id, draft: result.data } : null;
  }, [draft, previewing, version.data, template.id]);
  const preview = usePdfPreview(previewRequest, previewTemplate);

  const latest = versions.data?.[0];
  const status = {
    archivedAt,
    latestVersion: latest?.version ?? null,
    hasUnpublishedChanges: !latest || dayjs(baseUpdatedAt).isAfter(latest.publishedAt) || dirty,
  };

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

  return (
    <main className="mx-auto max-w-[96rem] space-y-4 p-4 py-6">
      <Link
        to="/templates"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Templates
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Template name"
          className="h-10 max-w-xl flex-1 border-transparent px-1 text-2xl font-semibold shadow-none hover:border-input md:text-2xl"
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
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <span role="status" className="text-sm text-muted-foreground">
              {save.isPending
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : `Saved ${dayjs(baseUpdatedAt).fromNow()}`}
            </span>
          )}
          {canEdit && (
            <Button
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
              variant="outline"
              disabled={dirty || !!archivedAt || !status.hasUnpublishedChanges}
              title={
                dirty
                  ? "Save your changes first"
                  : archivedAt
                    ? "Restore it first"
                    : status.hasUnpublishedChanges
                      ? undefined
                      : `Nothing changed since version ${latest?.version}`
              }
              onClick={() => setDialog("publish")}
            >
              Publish
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label="More actions" />}
            >
              <MoreHorizontalIcon />
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
          <AlertDescription>
            You can review this draft and its preview, but not change it.
          </AlertDescription>
        </Alert>
      )}
      {archivedAt && (
        <Alert>
          <AlertDescription>
            Archived {dayjs(archivedAt).fromNow()}: hidden from filling and the API. Its versions
            stay for history and re-runs.
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
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
        <Alert>
          <TriangleAlertIcon />
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

      <div
        className={
          draft.kind === "overlay"
            ? "grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)]"
            : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
        }
      >
        <Tabs defaultValue="content">
          <TabsList className="flex-wrap">
            <TabsTrigger value="content">
              {draft.kind === "overlay" ? "Boxes" : "Content"}
            </TabsTrigger>
            {draft.kind === "designed" && <TabsTrigger value="bands">Header & footer</TabsTrigger>}
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="sample">Sample data</TabsTrigger>
            <TabsTrigger value="signing">Signing</TabsTrigger>
            <TabsTrigger value="page">
              {draft.kind === "overlay" ? "PDF" : "Page & theme"}
            </TabsTrigger>
            {draft.kind === "designed" && <TabsTrigger value="css">CSS</TabsTrigger>}
            <TabsTrigger value="tests">Tests</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
          </TabsList>
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
                  onContent={(content) =>
                    setDraft((d) => (d.kind === "overlay" ? { ...d, content } : d))
                  }
                />
              </TabsContent>
            </>
          ) : (
            <>
              {/* Editors stay mounted so their undo history and cursor survive tab switches. */}
              <TabsContent value="content" keepMounted>
                <BodyPanel
                  content={draft.content}
                  onChange={setContent}
                  sections={draft.sections}
                  editable={canEdit}
                />
              </TabsContent>
              <TabsContent value="bands" keepMounted>
                <BandsPanel
                  content={draft.content}
                  onChange={setContent}
                  sections={draft.sections}
                  editable={canEdit}
                />
              </TabsContent>
              <TabsContent value="page">
                <PagePanel draft={draft} onChange={changeDesigned} editable={canEdit} />
              </TabsContent>
              <TabsContent value="css" keepMounted>
                <CssPanel content={draft.content} onChange={setContent} editable={canEdit} />
              </TabsContent>
            </>
          )}
          <TabsContent value="fields">
            <FieldDesigner
              sections={draft.sections}
              onChange={(sections) => change({ sections })}
              disabled={!canEdit}
            />
          </TabsContent>
          <TabsContent value="sample">
            <SamplePanel
              sections={draft.sections}
              sampleData={draft.sampleData}
              onChange={(sampleData) => change({ sampleData })}
              editable={canEdit}
            />
          </TabsContent>
          <TabsContent value="signing">
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
          <TabsContent value="tests">
            <TestsPanel
              id={template.id}
              draftUpdatedAt={baseUpdatedAt}
              canEdit={canEdit}
              dirty={dirty}
            />
          </TabsContent>
          <TabsContent value="reviews">
            <ReviewsPanel templateId={template.id} canEdit={canEdit} dirty={dirty} />
          </TabsContent>
          <TabsContent value="versions">
            <VersionsPanel
              id={template.id}
              canEdit={canEdit}
              dirty={dirty}
              previewing={previewing}
              onPreview={setPreviewing}
              onRestored={() => onReload()}
            />
          </TabsContent>
        </Tabs>

        <section className="space-y-2 xl:sticky xl:top-4 xl:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {previewing === null ? "Preview with sample data" : `Version ${previewing}`}
              {preview.data &&
                ` · ${preview.data.pageCount} ${preview.data.pageCount === 1 ? "page" : "pages"}`}
            </span>
            <span className="flex items-center gap-2">
              {preview.data && !preview.data.dataValid && previewing === null && (
                <span className="text-amber-600">Sample data doesn't fit the fields</span>
              )}
              {preview.isFetching
                ? "Rendering…"
                : previewRequest
                  ? "Up to date"
                  : "Fix the problems to preview"}
              {previewing !== null && (
                <Button variant="outline" size="xs" onClick={() => setPreviewing(null)}>
                  Back to draft
                </Button>
              )}
            </span>
          </div>
          <ErrorAlert error={preview.error ?? version.error} />
          {preview.data && preview.data.warnings.length > 0 && (
            <Alert>
              <TriangleAlertIcon />
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
            <PdfFrame pdf={preview.data.pdf} title="Template preview" className="h-[82svh]" />
          ) : (
            <div className="flex h-[82svh] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              {preview.error ? "The preview couldn't render." : "Rendering preview…"}
            </div>
          )}
        </section>
      </div>

      {dialog === "publish" && (
        <PublishDialog
          template={{
            id: template.id,
            name: draft.name,
            latestVersion: latest?.version ?? null,
            updatedAt: baseUpdatedAt,
          }}
          onClose={() => setDialog(null)}
          onPublished={(v) => {
            setDialog(null);
            setNotice(`Published version ${v}.`);
          }}
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
    </main>
  );
}
