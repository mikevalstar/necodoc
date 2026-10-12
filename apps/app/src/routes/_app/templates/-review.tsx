import { type ReviewStatus, reviewStatusLabels } from "@necodoc/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorAlert } from "@/components/form";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/review-and-approval.md. The template page's side of review: submit,
// withdraw, the current state and the history.

export const reviewStateQuery = (templateId: string) =>
  queryOptions({
    queryKey: ["reviews", "template", templateId],
    queryFn: async () =>
      (await ok(api.reviews.templates[":templateId"].$get({ param: { templateId } }))).json(),
  });

const statusVariant: Record<ReviewStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  changes_requested: "destructive",
  approved: "default",
  published: "outline",
  withdrawn: "outline",
};

export function ReviewStatusBadge({ status, stale }: { status: ReviewStatus; stale: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Badge variant={statusVariant[status]}>{reviewStatusLabels[status]}</Badge>
      {stale && (
        <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
          Draft changed since
        </Badge>
      )}
    </span>
  );
}

export function SubmitReviewDialog({
  templateId,
  resubmit,
  onClose,
}: {
  templateId: string;
  resubmit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const submit = useMutation({
    mutationFn: async () =>
      (
        await ok(api.reviews.$post({ json: { templateId, note: note.trim() || undefined } }))
      ).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
      toast.success(resubmit ? "Resubmitted for review" : "Submitted for review");
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{resubmit ? "Resubmit for review" : "Submit for review"}</DialogTitle>
            <DialogDescription>
              Reviewers are notified. The review covers the saved draft as it is now; editing it
              afterwards means resubmitting.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="review-note">Note for the reviewer (optional)</FieldLabel>
            <Textarea
              id="review-note"
              rows={3}
              maxLength={5000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <FieldDescription>What changed and what to look at.</FieldDescription>
          </Field>
          <ErrorAlert error={submit.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : resubmit ? "Resubmit" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Reviews tab: the open review and every earlier one. */
export function ReviewsPanel({
  templateId,
  canEdit,
  dirty,
}: {
  templateId: string;
  canEdit: boolean;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const state = useQuery(reviewStateQuery(templateId));
  const [submitting, setSubmitting] = useState(false);
  const withdraw = useMutation({
    mutationFn: async (id: string) =>
      (await ok(api.reviews[":id"].withdraw.$post({ param: { id } }))).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
      toast.success("Review withdrawn");
    },
  });
  const current = state.data?.current;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {state.data?.settings.requireReview
          ? "Publishing needs an approved review of the saved draft."
          : "Review is optional here: an admin hasn't made it a condition for publishing."}
      </p>
      <ErrorAlert error={state.error ?? withdraw.error} />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={dirty}
            title={dirty ? "Save your changes first" : undefined}
            onClick={() => setSubmitting(true)}
          >
            {current ? "Resubmit for review" : "Submit for review"}
          </Button>
          {current && (
            <Button
              size="sm"
              variant="outline"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate(current.id)}
            >
              Withdraw
            </Button>
          )}
        </div>
      )}
      {state.data?.history.length === 0 && (
        <p className="text-sm text-muted-foreground">No reviews yet.</p>
      )}
      {state.data?.history.map((r) => (
        <Link
          key={r.id}
          to="/templates/reviews/$reviewId"
          params={{ reviewId: r.id }}
          className="block space-y-1 rounded-lg border p-3 text-sm hover:bg-muted/50"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ReviewStatusBadge status={r.status} stale={r.stale} />
            {r.publishedVersion !== null && <span>Version {r.publishedVersion}</span>}
            <span className="ml-auto text-xs text-muted-foreground">
              {dayjs(r.submittedAt).format("MMM D, YYYY h:mm A")}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Submitted by {r.submitterName ?? "a deleted user"}
            {r.deciderName && ` · decided by ${r.deciderName}`}
            {r.decidedAt && ` ${dayjs(r.decidedAt).fromNow()}`}
          </div>
          {r.note && <p className="whitespace-pre-wrap">{r.note}</p>}
        </Link>
      ))}
      {submitting && (
        <SubmitReviewDialog
          templateId={templateId}
          resubmit={!!current}
          onClose={() => setSubmitting(false)}
        />
      )}
    </div>
  );
}
