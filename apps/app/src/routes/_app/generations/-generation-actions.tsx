import type { GenerationSource, GenerationStatus } from "@necodoc/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/generation-log.md

export const sourceLabels = {
  app: "App",
  api: "API",
  share_link: "Share link",
  combine: "Combine",
  rerun: "Re-run",
  batch: "Batch",
} satisfies Record<GenerationSource, string>;

export const statusLabels = {
  queued: "Queued",
  running: "Running",
  success: "Success",
  error: "Error",
  cancelled: "Cancelled",
} satisfies Record<GenerationStatus, string>;

const statusVariants = {
  queued: "secondary",
  running: "run",
  success: "ok",
  error: "bad",
  cancelled: "secondary",
} as const satisfies Record<GenerationStatus, string>;

export function StatusBadge({ status }: { status: GenerationStatus }) {
  return (
    <Badge dot variant={statusVariants[status]}>
      {statusLabels[status]}
    </Badge>
  );
}

/** 1234 → "1.23 s", 87 → "87 ms"; null (not finished) → "—". */
export const formatMs = (ms: number | null) =>
  ms === null ? "—" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

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
      toast.success("Re-run queued", { description: "This is the new entry." });
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
      toast.success(`Deleted ${generation.filename}`);
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

const linkLifetimes = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86_400, label: "24 hours" },
  { seconds: 7 * 86_400, label: "7 days" },
] as const;

/**
 * A signed link to the PDF that works without signing in, for sending to someone
 * (docs/features/generation-log.md, signed download links). Revoked by deleting the entry.
 */
export function SignedLinkDialog({
  generation,
  onClose,
}: {
  generation: { id: string; filename: string };
  onClose: () => void;
}) {
  const [seconds, setSeconds] = useState<number>(linkLifetimes[0].seconds);
  const mint = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.generations[":id"].link.$post({
            param: { id: generation.id },
            json: { expiresInSeconds: seconds },
          }),
        )
      ).json(),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signed download link</DialogTitle>
          <DialogDescription>
            Anyone with the link can download {generation.filename} without signing in, until it
            expires. Deleting the entry stops it early.
          </DialogDescription>
        </DialogHeader>
        {mint.data ? (
          <div className="space-y-2">
            <Input
              readOnly
              aria-label="Signed link"
              className="font-mono text-xs"
              value={mint.data.url}
              onFocus={(e) => e.target.select()}
            />
            <p className="text-sm text-muted-foreground">
              Expires {dayjs(mint.data.expiresAt).format("YYYY-MM-DD HH:mm")} (
              {dayjs(mint.data.expiresAt).fromNow()}).
            </p>
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="link-lifetime">Works for</FieldLabel>
            <NativeSelect
              id="link-lifetime"
              value={String(seconds)}
              onChange={(e) => setSeconds(Number(e.target.value))}
            >
              {linkLifetimes.map((lifetime) => (
                <NativeSelectOption key={lifetime.seconds} value={String(lifetime.seconds)}>
                  {lifetime.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        <ErrorAlert error={mint.error} />
        <DialogFooter>
          {mint.data ? (
            <>
              <CopyButton text={mint.data.url} label="Copy link" />
              <DialogClose render={<Button />}>Done</DialogClose>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button disabled={mint.isPending} onClick={() => mint.mutate()}>
                {mint.isPending ? "Creating…" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
