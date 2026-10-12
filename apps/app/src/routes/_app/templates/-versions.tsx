import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SuggestButton, useAiEnabled } from "@/components/ai";
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
import { Textarea } from "@/components/ui/textarea";
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
  canPublish,
  dirty,
  previewing,
  onPreview,
  onRestored,
}: {
  id: string;
  canEdit: boolean;
  /** Publishers can write or fix a version's change note. */
  canPublish: boolean;
  /** Unsaved edits, which a restore throws away too. */
  dirty: boolean;
  previewing: number | null;
  onPreview: (version: number | null) => void;
  onRestored: () => void;
}) {
  const versions = useQuery(versionsQuery(id));
  const [restoring, setRestoring] = useState<number | null>(null);
  const [noting, setNoting] = useState<number | null>(null);
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
            {noting === v.version ? (
              <NoteEditor
                id={id}
                version={v.version}
                note={v.note ?? ""}
                onDone={() => setNoting(null)}
              />
            ) : (
              v.note && <p className="whitespace-pre-wrap">{v.note}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant={previewing === v.version ? "secondary" : "outline"}
              size="sm"
              onClick={() => onPreview(previewing === v.version ? null : v.version)}
            >
              {previewing === v.version ? "Previewing" : "Preview"}
            </Button>
            {canPublish && noting !== v.version && (
              <Button variant="ghost" size="sm" onClick={() => setNoting(v.version)}>
                {v.note ? "Edit note" : "Add note"}
              </Button>
            )}
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
      toast.success(`Restored version ${version} into the draft`);
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

/** A version's change note, written or drafted by AI from its diff against the version before. */
function NoteEditor({
  id,
  version,
  note,
  onDone,
}: {
  id: string;
  version: number;
  note: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const aiEnabled = useAiEnabled();
  const [text, setText] = useState(note);
  const save = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.templates[":id"].versions[":version"].note.$patch({
            param: { id, version: String(version) },
            json: { note: text.trim() || undefined },
          }),
        )
      ).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: versionsQuery(id).queryKey });
      onDone();
    },
  });
  return (
    <div className="space-y-2 pt-1">
      <Textarea
        aria-label={`Change note for version ${version}`}
        rows={3}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ErrorAlert error={save.error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save note
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {aiEnabled && (
          <SuggestButton
            suggest={async () =>
              (
                await (
                  await ok(api.templates[":id"].ai.note.$post({ param: { id }, json: { version } }))
                ).json()
              ).text
            }
            onSuggested={setText}
          />
        )}
      </div>
    </div>
  );
}
