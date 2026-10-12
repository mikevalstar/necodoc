import type { CreateSubmission, GenerationStatus, SubmissionStatus } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
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
import { api, ok } from "@/lib/api";

// Spec: docs/features/filling-out-a-document.md

/** Draft, or finished with where its PDF is at. */
export function DocumentStatusBadge({
  status,
  generationStatus,
}: {
  status: SubmissionStatus;
  generationStatus: GenerationStatus | null;
}) {
  if (status === "draft") return <Badge variant="outline">Draft</Badge>;
  if (generationStatus === "error") return <Badge variant="destructive">PDF failed</Badge>;
  if (generationStatus === "queued" || generationStatus === "running") {
    return <Badge variant="outline">Making PDF…</Badge>;
  }
  return <Badge variant="secondary">Finished</Badge>;
}

/** Creates a draft (blank, or from a previous document's answers) and opens it. */
export function useStartDocument() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (json: CreateSubmission) =>
      (await ok(api.submissions.$post({ json }))).json(),
    onSuccess: async ({ id }, { fromSubmissionId }) => {
      if (fromSubmissionId) toast.success("New draft started from the earlier answers");
      await queryClient.invalidateQueries({ queryKey: ["submissions", "list"] });
      await navigate({ to: "/documents/$id", params: { id } });
    },
  });
}

export function DeleteDocumentDialog({
  document,
  onClose,
  onDeleted,
}: {
  document: { id: string; name: string };
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => ok(api.submissions[":id"].$delete({ param: { id: document.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["submissions", document.id] });
      await queryClient.invalidateQueries({ queryKey: ["submissions", "list"] });
      toast.success(`Deleted ${document.name}`);
      onClose();
      onDeleted?.();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {document.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes the document and its answers. PDFs already made stay in the generation log.
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
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
