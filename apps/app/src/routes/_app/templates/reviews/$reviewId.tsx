import { hasPermission, type ReviewDecision, type ReviewEventKind } from "@necodoc/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorAlert } from "@/components/form";
import { BackLink, FaqLink, ListSkeleton, Page } from "@/components/page";
import { TemplateDiffView } from "@/components/template-diff";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VisualDiff } from "@/components/visual-diff";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { templateQuery } from "../-draft";
import { ReviewStatusBadge } from "../-review";
import { PublishDialog } from "../-template-actions";
import { TestRun, testCasesQuery } from "../-tests";

// Spec: docs/features/review-and-approval.md (review page): what changed, structurally and on
// the page, the tests, and the thread where the decision is made.

const reviewQuery = (id: string) =>
  queryOptions({
    queryKey: ["reviews", id],
    queryFn: async () => (await ok(api.reviews[":id"].$get({ param: { id } }))).json(),
  });

export const Route = createFileRoute("/_app/templates/reviews/$reviewId")({
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const seesDrafts = (["edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!seesDrafts) throw redirect({ to: "/templates" });
  },
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

function ReviewPage() {
  const { reviewId } = Route.useParams();
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const review = useQuery(reviewQuery(reviewId));
  const templateId = review.data?.templateId;
  const draft = useQuery({ ...templateQuery(templateId ?? ""), enabled: !!templateId });
  const cases = useQuery({ ...testCasesQuery(templateId ?? ""), enabled: !!templateId });
  const [comment, setComment] = useState("");
  const [publishing, setPublishing] = useState(false);

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

  if (!review.data) {
    return (
      <Page width="wide">
        <BackLink to="/templates/reviews">Reviews</BackLink>
        {review.error ? <ErrorAlert error={review.error} /> : <ListSkeleton rows={3} />}
      </Page>
    );
  }
  const r = review.data;
  const roles = me.user.roles;
  const canReview = hasPermission(roles, { document: ["review"] });
  const canPublish = hasPermission(roles, { document: ["publish"] });
  const own = r.submittedBy === me.user.id;
  const mayDecide = canReview && (!own || r.settings.allowSelfApproval);
  const open =
    r.status === "pending" || r.status === "changes_requested" || r.status === "approved";
  const publishable = r.status === "approved" && !r.stale;

  return (
    <Page width="wide" className="space-y-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <BackLink to="/templates/reviews">Reviews</BackLink>
        <FaqLink feature="Review and approval" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{r.templateName}</h1>
        <ReviewStatusBadge status={r.status} stale={r.stale} />
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/templates/$id" params={{ id: r.templateId }} />}
          >
            Open template
          </Button>
          {canPublish && open && (
            <Button
              disabled={!publishable && r.settings.requireReview}
              title={
                publishable || !r.settings.requireReview
                  ? undefined
                  : "Publishing needs this review approved, for the current draft"
              }
              onClick={() => setPublishing(true)}
            >
              Publish
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Submitted by {r.submitterName ?? "a deleted user"} {dayjs(r.submittedAt).fromNow()}
        {r.baseVersion !== null
          ? `, against version ${r.baseVersion}`
          : ", before the first version"}
        {r.publishedVersion !== null && ` · published as version ${r.publishedVersion}`}
      </p>
      {r.stale && (
        <Alert>
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
            Version {r.latestVersion} was published since; the diffs compare with it.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)]">
        <Tabs defaultValue="changes">
          <TabsList>
            <TabsTrigger value="changes">Changes</TabsTrigger>
            <TabsTrigger value="visual">Visual diff</TabsTrigger>
            <TabsTrigger value="tests">Tests</TabsTrigger>
          </TabsList>
          <TabsContent value="changes">
            <TemplateDiffView id={r.templateId} />
          </TabsContent>
          <TabsContent value="visual">
            {draft.data && (
              <VisualDiff
                templateId={r.templateId}
                cases={cases.data ?? []}
                draftUpdatedAt={draft.data.updatedAt}
              />
            )}
          </TabsContent>
          <TabsContent value="tests">
            {draft.data && <TestRun id={r.templateId} draftUpdatedAt={draft.data.updatedAt} />}
          </TabsContent>
        </Tabs>

        <section className="space-y-3">
          <h2 className="font-medium">Discussion</h2>
          <ol className="space-y-2">
            {r.events.map((e) => (
              <li key={e.id} className="rounded-lg border p-3 text-sm">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {e.authorName ?? "A deleted user"}
                  </span>{" "}
                  {eventLabels[e.kind]} · {dayjs(e.createdAt).fromNow()}
                </div>
                {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
              </li>
            ))}
          </ol>
          {open && (
            <div className="space-y-2">
              <Field>
                <FieldLabel htmlFor="review-comment">Comment</FieldLabel>
                <Textarea
                  id="review-comment"
                  rows={3}
                  maxLength={5000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>
              <ErrorAlert error={decide.error ?? addComment.error} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!comment.trim() || addComment.isPending}
                  onClick={() => addComment.mutate()}
                >
                  Comment
                </Button>
                {mayDecide && (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={
                        !comment.trim() || decide.isPending || r.status === "changes_requested"
                      }
                      title={comment.trim() ? undefined : "Say what needs to change"}
                      onClick={() => decide.mutate({ decision: "request_changes", comment })}
                    >
                      Request changes
                    </Button>
                    <Button
                      size="sm"
                      disabled={decide.isPending || r.status !== "pending" || r.stale}
                      onClick={() =>
                        decide.mutate({ decision: "approve", comment: comment.trim() || undefined })
                      }
                    >
                      Approve
                    </Button>
                  </>
                )}
              </div>
              {canReview && !mayDecide && (
                <p className="text-xs text-muted-foreground">
                  You submitted this, so someone else has to approve it or request changes.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
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
