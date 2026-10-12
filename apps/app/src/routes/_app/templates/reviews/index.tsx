import { hasPermission } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ClipboardCheckIcon } from "lucide-react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { ReviewStatusBadge } from "../-review";

// Spec: docs/features/review-and-approval.md (reviews queue). Open reviews, oldest first.

const searchSchema = z.object({ status: z.enum(["open", "all"]).optional() });

export const Route = createFileRoute("/_app/templates/reviews/")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const seesDrafts = (["edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!seesDrafts) throw redirect({ to: "/templates" });
  },
  component: Reviews,
});

function Reviews() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const status = search.status ?? "open";
  const reviews = useQuery({
    queryKey: ["reviews", "list", status],
    queryFn: async () => (await ok(api.reviews.$get({ query: { status } }))).json(),
    refetchInterval: 30_000,
  });
  return (
    <Page>
      <PageHeader
        title="Reviews"
        description="Template drafts submitted for review. Open one to see what changed and decide."
        actions={<FaqLink feature="Review and approval" />}
      />
      <fieldset className="flex gap-1" aria-label="Show">
        {(["open", "all"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "secondary" : "ghost"}
            aria-pressed={status === s}
            onClick={() => navigate({ search: { status: s === "open" ? undefined : s } })}
          >
            {s === "open" ? "Open" : "All"}
          </Button>
        ))}
      </fieldset>
      <ErrorAlert error={reviews.error} />
      {reviews.isPending ? (
        <ListSkeleton />
      ) : reviews.data?.length === 0 ? (
        <EmptyState
          icon={ClipboardCheckIcon}
          title={status === "open" ? "Nothing waiting for review" : "No reviews yet"}
          description="An editor submits a saved draft from the template's page (Submit for review); it shows here for reviewers."
          action={
            status === "open" && (
              <Button variant="outline" onClick={() => navigate({ search: { status: "all" } })}>
                Show all reviews
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/templates/reviews/$reviewId"
                    params={{ reviewId: r.id }}
                    className="hover:underline"
                  >
                    {r.templateName}
                  </Link>
                  {r.baseVersion !== null && (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · against v{r.baseVersion}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <ReviewStatusBadge status={r.status} stale={r.stale} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {r.submitterName ?? "A deleted user"}, {dayjs(r.submittedAt).fromNow()}
                </TableCell>
                <TableCell className="max-w-sm truncate text-sm text-muted-foreground">
                  {r.note}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
