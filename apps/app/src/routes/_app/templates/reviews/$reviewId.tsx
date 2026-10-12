import { hasPermission, type ReviewDecision, type ReviewEventKind } from "@necodoc/shared";
import { ArrowSquareOutIcon, SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/form";
import { BackLink, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { TemplateDiffView } from "@/components/template-diff";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VisualDiff } from "@/components/visual-diff";
import { api, ok } from "@/lib/api";
import { requireAccess } from "@/lib/auth";
import { usePageCrumb } from "@/lib/breadcrumb";
import { dayjs } from "@/lib/date";
import { templateQuery } from "../-draft";
import { ReviewStatusBadge } from "../-review";
import { PublishDialog } from "../-template-actions";
import { TestRun, testCasesQuery, testRunQuery, testSummary } from "../-tests";

// Spec: docs/features/review-and-approval.md (review page): what changed, structurally and on
// the page, the tests, and the thread where the decision is made.

const reviewQuery = (id: string) =>
  queryOptions({
    queryKey: ["reviews", id],
    queryFn: async () => (await ok(api.reviews[":id"].$get({ param: { id } }))).json(),
  });

export const Route = createFileRoute("/_app/templates/reviews/$reviewId")({
  beforeLoad: ({ context }) => requireAccess(context.me, ["edit", "review", "publish"]),
  component: ReviewPage,
});

const eventLabels: Record<ReviewEventKind, string> = {
  submitted: "submitted it for review",
  resubmitted: "resubmitted it",
  comment: "commented",
  changes_requested: "requested changes",
  approved: "approved it",
  published: "published it",
  withdrawn: "withdrew it",
};

const fullDate = (iso: string) => dayjs(iso).format("MMM D, YYYY h:mm A");

function ReviewPage() {
  const { reviewId } = Route.useParams();
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const review = useQuery(reviewQuery(reviewId));
  usePageCrumb(review.data?.templateName);
  const templateId = review.data?.templateId;
  const draft = useQuery({ ...templateQuery(templateId ?? ""), enabled: !!templateId });
  const cases = useQuery({ ...testCasesQuery(templateId ?? ""), enabled: !!templateId });
  const [comment, setComment] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirmingApproval, setConfirmingApproval] = useState(false);

  const roles = me.user.roles;
  const canReview = hasPermission(roles, { document: ["review"] });
  const canPublish = hasPermission(roles, { document: ["publish"] });
  const canEdit = hasPermission(roles, { document: ["edit"] });
  const r = review.data;
  const mayDecide =
    !!r && canReview && (r.submittedBy !== me.user.id || r.settings.allowSelfApproval);
  // The API's rules: approve a pending, current draft; request changes on pending or approved.
  const canApprove = mayDecide && r?.status === "pending" && !r.stale;
  const canRequestChanges = mayDecide && (r?.status === "pending" || r?.status === "approved");
  // The approver sees the test result next to Approve; same cache as the Tests tab.
  const tests = useQuery({
    ...testRunQuery(templateId ?? "", draft.data?.updatedAt ?? ""),
    enabled: canApprove && !!draft.data,
  });
  const summary = testSummary(tests.data?.results);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["reviews"] });
  const decide = useMutation({
    mutationFn: async (json: ReviewDecision) =>
      (await ok(api.reviews[":id"].decision.$post({ param: { id: reviewId }, json }))).json(),
    onSuccess: async (_, decision) => {
      setComment("");
      toast.success(decision.decision === "approve" ? "Approved" : "Changes requested");
      await refresh();
    },
  });
  const approve = () =>
    decide.mutate(
      { decision: "approve", comment: comment.trim() || undefined },
      { onSettled: () => setConfirmingApproval(false) },
    );
  const addComment = useMutation({
    mutationFn: async () =>
      (
        await ok(
          api.reviews[":id"].comments.$post({ param: { id: reviewId }, json: { body: comment } }),
        )
      ).json(),
    onSuccess: async () => {
      setComment("");
      await refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: async () =>
      (await ok(api.reviews[":id"].withdraw.$post({ param: { id: reviewId } }))).json(),
    onSuccess: async () => {
      setWithdrawing(false);
      toast.success("Review withdrawn");
      await refresh();
    },
  });

  if (!r) {
    return (
      <Page width="wide">
        <BackLink to="/templates/reviews">Reviews</BackLink>
        {review.error ? <ErrorAlert error={review.error} /> : <ListSkeleton rows={3} />}
      </Page>
    );
  }
  const open =
    r.status === "pending" || r.status === "changes_requested" || r.status === "approved";
  const publishable = r.status === "approved" && !r.stale;
  const publishBlocked = !publishable && r.settings.requireReview;
  const busy = decide.isPending || addComment.isPending;
  const hasComment = comment.trim().length > 0;

  // Why the decision buttons are off, in one line under them.
  const decisionNote = !open
    ? null
    : r.stale
      ? "The draft changed since it was submitted. The editor has to resubmit before it can be approved."
      : r.status === "changes_requested"
        ? "Changes were requested. The editor fixes the draft and resubmits."
        : r.status === "approved"
          ? `Approved. ${publishable && canPublish ? "Publish it from the top of the page" : "A publisher can publish it now"}; requesting changes takes the approval back.`
          : null;

  return (
    <Page width="wide">
      <PageHeader
        back={<BackLink to="/templates/reviews">Reviews</BackLink>}
        title={r.templateName}
        description={
          <>
            Submitted by {r.submitterName ?? "a deleted user"}{" "}
            <time dateTime={r.submittedAt} title={fullDate(r.submittedAt)}>
              {dayjs(r.submittedAt).fromNow()}
            </time>
            {r.baseVersion !== null
              ? `, compared with version ${r.baseVersion}`
              : ", before the first version"}
            {r.publishedVersion !== null && `. Published as version ${r.publishedVersion}.`}
          </>
        }
        actions={
          <>
            <FaqLink feature="Review and approval" />
            {canEdit && open && (
              <Button variant="destructive" onClick={() => setWithdrawing(true)}>
                Withdraw…
              </Button>
            )}
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/templates/$id" params={{ id: r.templateId }} />}
            >
              <ArrowSquareOutIcon />
              Open template
            </Button>
            {canPublish && open && (
              <Button
                variant={publishable ? "default" : "outline"}
                disabled={publishBlocked || !draft.data}
                title={
                  publishBlocked
                    ? "Publishing needs this review approved, for the current draft"
                    : undefined
                }
                onClick={() => setPublishing(true)}
              >
                Publish…
              </Button>
            )}
          </>
        }
      >
        <ReviewStatusBadge status={r.status} stale={r.stale} />
      </PageHeader>

      {r.stale && (
        <Alert>
          <WarningIcon className="text-warn" />
          <AlertTitle>The draft changed since this was submitted</AlertTitle>
          <AlertDescription>
            {r.staleReason ??
              "What you see below is the current draft, not what was submitted. It can't be approved or published until the editor resubmits."}
          </AlertDescription>
        </Alert>
      )}
      {r.latestVersion !== r.baseVersion && open && (
        <Alert>
          <AlertDescription>
            Version {r.latestVersion} was published since it was submitted; the diffs compare with
            it.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,0.8fr)]">
        <Card>
          <Tabs defaultValue="changes" className="gap-4 px-5">
            <TabsList aria-label="What changed" className="self-start">
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="visual">Visual diff</TabsTrigger>
              <TabsTrigger value="tests">Tests</TabsTrigger>
            </TabsList>
            {!open && (
              <p className="text-[13px] text-ink-3">
                This review is closed. The tabs show the template's current draft, not what was
                reviewed.
              </p>
            )}
            <TabsContent value="changes">
              <TemplateDiffView id={r.templateId} />
            </TabsContent>
            <TabsContent value="visual">
              {draft.data ? (
                <VisualDiff
                  templateId={r.templateId}
                  cases={cases.data ?? []}
                  draftUpdatedAt={draft.data.updatedAt}
                />
              ) : (
                <ListSkeleton rows={2} />
              )}
            </TabsContent>
            <TabsContent value="tests">
              {draft.data ? (
                <TestRun id={r.templateId} draftUpdatedAt={draft.data.updatedAt} />
              ) : (
                <ListSkeleton rows={2} />
              )}
            </TabsContent>
          </Tabs>
        </Card>

        <Card className="xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle>
              <h2>Discussion</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2">
              {r.events.map((e) => (
                <li key={e.id} className="rounded-lg bg-tint p-3 text-sm">
                  <div className="text-[13px] text-ink-3">
                    <span className="font-semibold text-ink">
                      {e.authorName ?? "A deleted user"}
                    </span>{" "}
                    {eventLabels[e.kind]} ·{" "}
                    <time dateTime={e.createdAt} title={fullDate(e.createdAt)}>
                      {dayjs(e.createdAt).fromNow()}
                    </time>
                  </div>
                  {e.body && <p className="mt-1 whitespace-pre-wrap text-ink">{e.body}</p>}
                </li>
              ))}
            </ol>

            {open ? (
              <div className="space-y-3 border-t border-hair pt-4">
                <Field>
                  <FieldLabel htmlFor="review-comment">Comment</FieldLabel>
                  <Textarea
                    id="review-comment"
                    rows={3}
                    maxLength={5000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  {canRequestChanges && (
                    <FieldDescription>Required to request changes.</FieldDescription>
                  )}
                </Field>
                <ErrorAlert error={decide.error ?? addComment.error} />
                {canApprove && (
                  <p className="text-[13px] text-ink-3" role="status">
                    Tests on the current draft:{" "}
                    {tests.isFetching ? (
                      "running…"
                    ) : summary ? (
                      <Badge dot variant={summary.allPassed ? "ok" : "bad"}>
                        {summary.passed} of {summary.total} passing
                      </Badge>
                    ) : tests.error ? (
                      "couldn't run, see the Tests tab."
                    ) : (
                      "none set up."
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!hasComment || busy}
                    onClick={() => addComment.mutate()}
                  >
                    {addComment.isPending ? "Posting…" : "Comment"}
                  </Button>
                  {canRequestChanges && (
                    <div className="ml-auto flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!hasComment || busy}
                        title={hasComment ? undefined : "Say what needs to change in the comment"}
                        onClick={() => decide.mutate({ decision: "request_changes", comment })}
                      >
                        Request changes
                      </Button>
                      {r.status === "pending" && (
                        <Button
                          size="sm"
                          disabled={busy || !canApprove}
                          onClick={() =>
                            summary && !summary.allPassed ? setConfirmingApproval(true) : approve()
                          }
                        >
                          <SealCheckIcon />
                          Approve
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {mayDecide && decisionNote && (
                  <p className="text-[13px] text-ink-3">{decisionNote}</p>
                )}
                {canReview && !mayDecide && (
                  <p className="text-[13px] text-ink-3">
                    You submitted this, so someone else has to approve it or request changes.
                  </p>
                )}
              </div>
            ) : (
              <p className="border-t border-hair pt-4 text-[13px] text-ink-3">
                This review is closed
                {r.status === "published" ? ": the draft was published." : ": it was withdrawn."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {confirmingApproval && summary && (
        <ConfirmDialog
          title="Approve with failing tests?"
          description={`${summary.total - summary.passed} of ${summary.total} test cases fail on the current draft. Check the Tests tab first; approving lets a publisher publish it as it is.`}
          confirmLabel="Approve anyway"
          destructive={false}
          pending={decide.isPending}
          onConfirm={approve}
          onClose={() => setConfirmingApproval(false)}
        />
      )}
      {withdrawing && (
        <ConfirmDialog
          title="Withdraw this review?"
          description="Reviewers no longer see it as waiting for them, and any approval no longer counts for publishing. The draft can be submitted again later."
          confirmLabel="Withdraw review"
          pending={withdraw.isPending}
          error={withdraw.error}
          onConfirm={() => withdraw.mutate()}
          onClose={() => setWithdrawing(false)}
        />
      )}
      {publishing && draft.data && (
        <PublishDialog
          template={{
            id: r.templateId,
            name: draft.data.name,
            latestVersion: r.latestVersion,
            updatedAt: draft.data.updatedAt,
          }}
          onClose={() => setPublishing(false)}
          onPublished={async () => {
            setPublishing(false);
            await refresh();
          }}
        />
      )}
    </Page>
  );
}
