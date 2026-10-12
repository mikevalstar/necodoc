import { type ReviewStatus, reviewStatusLabels } from "@necodoc/shared";
import { SealCheckIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/form";
import { EmptyState, ListSkeleton } from "@/components/page";
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

const statusVariant = {
  pending: "warn",
  changes_requested: "bad",
  approved: "ok",
  published: "default",
  withdrawn: "secondary",
} as const satisfies Record<ReviewStatus, string>;

export function ReviewStatusBadge({ status, stale }: { status: ReviewStatus; stale: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Badge dot variant={statusVariant[status]}>
        {reviewStatusLabels[status]}
      </Badge>
      {stale && <Badge variant="warn">Draft changed since</Badge>}
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
  const [withdrawing, setWithdrawing] = useState(false);
  const withdraw = useMutation({
    mutationFn: async (id: string) =>
      (await ok(api.reviews[":id"].withdraw.$post({ param: { id } }))).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
      toast.success("Review withdrawn");
      setWithdrawing(false);
    },
  });
  const current = state.data?.current;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        {state.data?.settings.requireReview
          ? "Publishing needs an approved review of the saved draft."
          : "Review is optional here: an admin hasn't made it a condition for publishing."}
      </p>
      <ErrorAlert error={state.error} />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={dirty}
            title={dirty ? "Save your changes first" : undefined}
            onClick={() => setSubmitting(true)}
          >
            {current ? "Resubmit for review" : "Submit for review"}
          </Button>
          {current && (
            <Button size="sm" variant="destructive" onClick={() => setWithdrawing(true)}>
              Withdraw…
            </Button>
          )}
        </div>
      )}
      {state.isPending && <ListSkeleton rows={2} />}
      {state.data?.history.length === 0 && (
        <EmptyState
          icon={SealCheckIcon}
          title="No reviews yet"
          description="Submit the saved draft for review to have someone check it before it's published."
        />
      )}
      {state.data?.history.map((r) => (
        <Link
          key={r.id}
          to="/templates/reviews/$reviewId"
          params={{ reviewId: r.id }}
          className="block space-y-1 rounded-xl bg-tint p-3 text-sm hover:bg-tint-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ReviewStatusBadge status={r.status} stale={r.stale} />
            {r.publishedVersion !== null && <span>Version {r.publishedVersion}</span>}
            <span className="ml-auto font-mono text-xs text-ink-3">
              {dayjs(r.submittedAt).format("MMM D, YYYY h:mm A")}
            </span>
          </div>
          <div className="text-xs text-ink-3">
            Submitted by {r.submitterName ?? "a deleted user"}
            {r.deciderName && ` · decided by ${r.deciderName}`}
            {r.decidedAt && ` ${dayjs(r.decidedAt).fromNow()}`}
          </div>
          {r.note && <p className="whitespace-pre-wrap">{r.note}</p>}
        </Link>
      ))}
      {withdrawing && current && (
        <ConfirmDialog
          title="Withdraw this review?"
          description="Reviewers no longer see it as waiting for them. You can submit the draft again later."
          confirmLabel="Withdraw review"
          pending={withdraw.isPending}
          error={withdraw.error}
          onConfirm={() => withdraw.mutate(current.id)}
          onClose={() => setWithdrawing(false)}
        />
      )}
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
