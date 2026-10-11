import { publishTemplateSchema, type TemplateSummary } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
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
import { api, ok } from "@/lib/api";
import { templatesQuery } from "@/lib/queries";

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
        <Badge variant="outline">Draft</Badge>
      ) : (
        <Badge>Published v{template.latestVersion}</Badge>
      )}
      {status === "changes" && (
        <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
          Unpublished changes
        </Badge>
      )}
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey }),
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

/** Publishes the saved draft as version N+1, with an optional change note. */
export function PublishDialog({
  template,
  onClose,
  onPublished,
}: {
  template: { id: string; name: string; latestVersion: number | null };
  onClose: () => void;
  onPublished: (version: number) => void;
}) {
  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: async (json: { note?: string }) =>
      (await ok(api.templates[":id"].publish.$post({ param: { id: template.id }, json }))).json(),
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      onPublished(summary?.version ?? (template.latestVersion ?? 0) + 1);
    },
  });
  const form = useAppForm({
    defaultValues: { note: "" },
    validators: { onChange: z.object({ note: publishTemplateSchema.shape.note.unwrap() }) },
    onSubmit: ({ value }) => publish.mutate({ note: value.note.trim() || undefined }),
  });
  const next = (template.latestVersion ?? 0) + 1;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
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
          <form.AppField name="note">
            {(field) => (
              <field.TextareaField
                label="Change note (optional)"
                description="What changed, for the version history."
                rows={3}
              />
            )}
          </form.AppField>
          <ErrorAlert error={publish.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={publish.isPending}>
              {publish.isPending ? "Publishing…" : `Publish v${next}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
