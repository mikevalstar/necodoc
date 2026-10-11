import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
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
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/publishing-and-versions.md (version history, start a draft from a version).

export const versionsQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id, "versions"],
    queryFn: async () => (await ok(api.templates[":id"].versions.$get({ param: { id } }))).json(),
  });

export const versionQuery = (id: string, version: number) =>
  queryOptions({
    queryKey: ["templates", id, "versions", version],
    queryFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].$get({
            param: { id, version: String(version) },
          }),
        )
      ).json(),
    staleTime: Number.POSITIVE_INFINITY,
  });

export function VersionsPanel({
  id,
  canEdit,
  dirty,
  previewing,
  onPreview,
  onRestored,
}: {
  id: string;
  canEdit: boolean;
  /** Unsaved edits, which a restore throws away too. */
  dirty: boolean;
  previewing: number | null;
  onPreview: (version: number | null) => void;
  onRestored: () => void;
}) {
  const versions = useQuery(versionsQuery(id));
  const [restoring, setRestoring] = useState<number | null>(null);
  if (versions.data?.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not published yet. Publishing the saved draft creates version 1.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ErrorAlert error={versions.error} />
      {versions.data?.map((v) => (
        <div key={v.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Version {v.version}</span>
              {v.version === versions.data[0]?.version && <Badge>Latest</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {dayjs(v.publishedAt).format("MMM D, YYYY h:mm A")} by{" "}
              {v.publisherName ?? "a deleted user"}
            </div>
            {v.note && <p className="whitespace-pre-wrap">{v.note}</p>}
          </div>
          <div className="flex gap-2">
            <Button
              variant={previewing === v.version ? "secondary" : "outline"}
              size="sm"
              onClick={() => onPreview(previewing === v.version ? null : v.version)}
            >
              {previewing === v.version ? "Previewing" : "Preview"}
            </Button>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setRestoring(v.version)}>
                Restore to draft
              </Button>
            )}
          </div>
        </div>
      ))}
      {restoring !== null && (
        <RestoreDialog
          id={id}
          version={restoring}
          dirty={dirty}
          onClose={() => setRestoring(null)}
          onRestored={() => {
            setRestoring(null);
            onRestored();
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  id,
  version,
  dirty,
  onClose,
  onRestored,
}: {
  id: string;
  version: number;
  dirty: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].draft.$post({
            param: { id, version: String(version) },
          }),
        )
      ).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      onRestored();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace the draft with version {version}?</AlertDialogTitle>
          <AlertDialogDescription>
            The draft's content, fields, page setup, theme and sample data become version {version}
            's. Published versions don't change.
            {dirty && " Your unsaved changes are lost too."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorAlert error={restore.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={restore.isPending} onClick={() => restore.mutate()}>
            Restore version {version}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
