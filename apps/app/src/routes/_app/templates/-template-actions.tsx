import { publishTemplateSchema, type TemplateSummary } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { SuggestButton, useAiEnabled } from "@/components/ai";
import { ErrorAlert, useAppForm } from "@/components/form";
import { TemplateDiffView } from "@/components/template-diff";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisualDiff } from "@/components/visual-diff";
import { api, ok } from "@/lib/api";
import { templatesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ReviewStatusBadge, reviewStateQuery } from "./-review";
import { TestResults, testCasesQuery, testRunQuery, testSummary } from "./-tests";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md.

type StatusSource = Pick<TemplateSummary, "archivedAt" | "latestVersion" | "hasUnpublishedChanges">;

export const templateStatuses = {
  draft: "Draft, never published",
  published: "Published, up to date",
  changes: "Unpublished changes",
  archived: "Archived",
} as const;
export type TemplateStatus = keyof typeof templateStatuses;

/** Archived wins; otherwise whether it was ever published and whether the draft moved on. */
export function templateStatus(t: StatusSource): TemplateStatus {
  if (t.archivedAt) return "archived";
  if (t.latestVersion === null) return "draft";
  return t.hasUnpublishedChanges ? "changes" : "published";
}

export function TemplateStatusBadges({ template }: { template: StatusSource }) {
  const status = templateStatus(template);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {template.archivedAt && <Badge variant="secondary">Archived</Badge>}
      {template.latestVersion === null ? (
        <Badge dot variant="secondary">
          Draft
        </Badge>
      ) : (
        <Badge dot variant="ok">
          Published v{template.latestVersion}
        </Badge>
      )}
      {status === "changes" && <Badge variant="warn">Unpublished changes</Badge>}
    </span>
  );
}

/** Copies the draft (not its versions) and opens the copy. */
export function useDuplicateTemplate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (id: string) =>
      (await ok(api.templates[":id"].duplicate.$post({ param: { id } }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });
      await navigate({ to: "/templates/$id", params: { id: created.id } });
      toast.success(`Duplicated as ${created.name}`);
    },
  });
}

/** Archive hides a template from filling and the API; restore brings it back. */
export function useArchiveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const call = archive ? api.templates[":id"].archive : api.templates[":id"].restore;
      return (await ok(call.$post({ param: { id } }))).json();
    },
    onSuccess: async (row) => {
      toast.success(row.archivedAt ? `Archived ${row.name}` : `Restored ${row.name}`);
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });
    },
  });
}

/** Only never-published templates can be deleted; the API answers 409 otherwise. */
export function DeleteTemplateDialog({
  template,
  onClose,
}: {
  template: { id: string; name: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => ok(api.templates[":id"].$delete({ param: { id: template.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["templates", template.id] });
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey, exact: true });
      // The editor's unsaved-changes guard doesn't apply to a deleted draft.
      await navigate({ to: "/templates", ignoreBlocker: true });
      toast.success(`Deleted ${template.name}`);
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {template.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The draft and its fields are deleted. A template that has been published can't be
            deleted, only archived. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={remove.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete template
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Publishes the saved draft as version N+1, with an optional change note. Shows what's being
 * published: the review gate, test results, the structural diff and, on request, the visual diff.
 */
export function PublishDialog({
  template,
  onClose,
  onPublished,
}: {
  template: { id: string; name: string; latestVersion: number | null; updatedAt: string };
  onClose: () => void;
  onPublished: (version: number) => void;
}) {
  const queryClient = useQueryClient();
  const review = useQuery(reviewStateQuery(template.id));
  const tests = useQuery(testRunQuery(template.id, template.updatedAt));
  const cases = useQuery(testCasesQuery(template.id));
  const [visual, setVisual] = useState(false);
  const aiEnabled = useAiEnabled();
  const publish = useMutation({
    mutationFn: async (json: { note?: string }) =>
      (await ok(api.templates[":id"].publish.$post({ param: { id: template.id }, json }))).json(),
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
      const version = summary?.version ?? (template.latestVersion ?? 0) + 1;
      toast.success(`Published ${template.name} as version ${version}`);
      onPublished(version);
    },
  });
  const form = useAppForm({
    defaultValues: { note: "" },
    validators: { onChange: z.object({ note: publishTemplateSchema.shape.note.unwrap() }) },
    onSubmit: ({ value }) => publish.mutate({ note: value.note.trim() || undefined }),
  });
  const next = (template.latestVersion ?? 0) + 1;
  const settings = review.data?.settings;
  const summary = testSummary(tests.data?.results);
  const blockedByReview = !!settings?.requireReview && !review.data?.approved;
  const blockedByTests = !!settings?.blockOnFailingTests && !!summary && !summary.allPassed;
  const current = review.data?.current;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn("max-h-[90svh] overflow-y-auto", visual ? "sm:max-w-5xl" : "sm:max-w-xl")}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              Publish {template.name} as version {next}
            </DialogTitle>
            <DialogDescription>
              Publishing freezes the saved draft, its fields, theme and sample data. New documents
              use it; documents made from earlier versions don't change.
            </DialogDescription>
          </DialogHeader>
          <section className="space-y-1">
            <h3 className="text-sm font-medium">Review</h3>
            <p className="text-sm">
              {current ? (
                <>
                  <ReviewStatusBadge status={current.status} stale={current.stale} />{" "}
                  <Link
                    to="/templates/reviews/$reviewId"
                    params={{ reviewId: current.id }}
                    className="underline"
                  >
                    Open the review
                  </Link>
                </>
              ) : (
                <span className="text-muted-foreground">Not submitted for review.</span>
              )}
            </p>
            {blockedByReview && (
              <p className="text-sm text-destructive">
                Review is required: this exact draft needs an approved review first.
              </p>
            )}
          </section>
          <section className="space-y-1">
            <h3 className="text-sm font-medium">Tests</h3>
            <p className="text-sm text-muted-foreground" role="status">
              {tests.isFetching
                ? "Running tests…"
                : summary
                  ? `${summary.passed} of ${summary.total} passing`
                  : "No test cases."}
            </p>
            <ErrorAlert error={tests.error} />
            {summary && !summary.allPassed && tests.data && (
              <TestResults results={tests.data.results.filter((r) => !r.passed)} />
            )}
            {blockedByTests && (
              <p className="text-sm text-destructive">Publishing is blocked while tests fail.</p>
            )}
          </section>
          <section className="space-y-1">
            <h3 className="text-sm font-medium">What changed</h3>
            <TemplateDiffView id={template.id} compact />
            {template.latestVersion !== null && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setVisual((v) => !v)}
              >
                {visual ? "Hide visual diff" : "Show visual diff"}
              </Button>
            )}
            {visual && (
              <VisualDiff
                templateId={template.id}
                cases={cases.data ?? []}
                draftUpdatedAt={template.updatedAt}
              />
            )}
          </section>
          <form.AppField name="note">
            {(field) => (
              <field.TextareaField
                label="Change note (optional)"
                description="What changed, for the version history."
                rows={3}
              />
            )}
          </form.AppField>
          {aiEnabled && (
            <SuggestButton
              title="Sends the changes since the last version to Anthropic (Claude) and drafts the note. Edit it before publishing."
              suggest={async () =>
                (
                  await (
                    await ok(
                      api.templates[":id"].ai.note.$post({ param: { id: template.id }, json: {} }),
                    )
                  ).json()
                ).text
              }
              onSuggested={(text) => form.setFieldValue("note", text)}
            />
          )}
          <ErrorAlert error={publish.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={publish.isPending || blockedByReview || blockedByTests}>
              {publish.isPending ? "Publishing…" : `Publish v${next}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
