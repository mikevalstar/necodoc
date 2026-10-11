import type { createThemeSchema, Theme } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { z } from "zod";
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
import { api, ok } from "@/lib/api";
import { themesQuery } from "@/lib/queries";

// Spec: docs/features/document-themes.md. Starters are copied, never edited.

type ThemeSource = z.input<typeof createThemeSchema>;

/** Copies a theme and opens the copy in the editor. */
export function useDuplicateTheme() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (source: ThemeSource) =>
      (await ok(api.themes.$post({ json: { ...source, name: `${source.name} copy` } }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: themesQuery.queryKey });
      await navigate({ to: "/themes/$id", params: { id: created.id } });
    },
  });
}

export function DeleteThemeDialog({
  theme,
  onClose,
}: {
  theme: Pick<Theme, "id" | "name">;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => ok(api.themes[":id"].$delete({ param: { id: theme.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: themesQuery.queryKey });
      await navigate({ to: "/themes" });
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {theme.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Renders that name this theme, including re-runs of old generations, will fail. It can't
            be undone.
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
            Delete theme
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
