import type { GenerationSource, GenerationStatus } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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

// Spec: docs/features/generation-log.md

export const sourceLabels = {
  app: "App",
  api: "API",
  share_link: "Share link",
  combine: "Combine",
  rerun: "Re-run",
} satisfies Record<GenerationSource, string>;

export function StatusBadge({ status }: { status: GenerationStatus }) {
  return status === "success" ? (
    <Badge variant="secondary">Success</Badge>
  ) : (
    <Badge variant="destructive">Error</Badge>
  );
}

/** Re-renders the stored input as a new entry, then opens it. */
export function useRerun() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (id: string) =>
      (await ok(api.generations[":id"].rerun.$post({ param: { id } }))).json(),
    onSuccess: async (rerun) => {
      await queryClient.invalidateQueries({ queryKey: ["generations"] });
      await navigate({ to: "/generations/$id", params: { id: rerun.id } });
    },
  });
}

export function DeleteGenerationDialog({
  generation,
  onClose,
  onDeleted,
}: {
  generation: { id: string; filename: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => ok(api.generations[":id"].$delete({ param: { id: generation.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["generations", generation.id] });
      await queryClient.invalidateQueries({ queryKey: ["generations"] });
      onDeleted();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {generation.filename}?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes the log entry, its input and its PDF. It can't be undone.
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
