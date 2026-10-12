import { hasPermission } from "@necodoc/shared";
import { SealCheckIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { ReviewStatusBadge } from "../-review";

// Spec: docs/features/review-and-approval.md (reviews queue). Open reviews, oldest first.

const statusSchema = z.enum(["open", "all"]);
const searchSchema = z.object({ status: statusSchema.optional() });

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
  const rows = reviews.data ?? [];
  return (
    <Page>
      <PageHeader
        title="Reviews"
        description="Template drafts submitted for review. Open one to see what changed and decide."
        actions={<FaqLink feature="Review and approval" />}
      />
      <ErrorAlert error={reviews.error} />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
          <Tabs
            value={status}
            onValueChange={(value) => {
              const next = statusSchema.safeParse(value).data;
              navigate({ search: { status: next === "all" ? "all" : undefined } });
            }}
          >
            <TabsList aria-label="Show">
              <TabsTrigger value="open" className="h-8 flex-none">
                Open
              </TabsTrigger>
              <TabsTrigger value="all" className="h-8 flex-none">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-3">
            {reviews.isSuccess && (
              <span className="text-[13px] text-ink-3" aria-live="polite">
                {status === "open"
                  ? `${rows.length} open, oldest first`
                  : `${rows.length} ${rows.length === 1 ? "review" : "reviews"}`}
              </span>
            )}
            <DensityToggle />
          </div>
        </div>
        {reviews.isPending ? (
          <ListSkeleton className="p-4" />
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={SealCheckIcon}
            title={status === "open" ? "Nothing waiting for review" : "No reviews yet"}
            description="When an editor submits a template draft for review (from the template's page), it shows up here."
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
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Compared with</TableHead>
                <TableHead className="pr-4">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-72 min-w-48 pl-4 whitespace-normal lg:max-w-xl">
                    <Link
                      to="/templates/reviews/$reviewId"
                      params={{ reviewId: r.id }}
                      className="font-semibold hover:text-brand-ink hover:underline"
                    >
                      {r.templateName}
                    </Link>
                    {r.note && (
                      <p className="truncate text-[12.5px] text-ink-3" title={r.note}>
                        {r.note}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <ReviewStatusBadge status={r.status} stale={r.stale} />
                  </TableCell>
                  <TableCell className="hidden text-ink-2 md:table-cell">
                    {r.baseVersion === null ? (
                      "Not published yet"
                    ) : (
                      <span className="font-mono text-[13px]">v{r.baseVersion}</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-ink-2">
                    {r.submitterName ?? "A deleted user"}
                    <span className="text-ink-3">
                      {" · "}
                      <time
                        dateTime={r.submittedAt}
                        title={dayjs(r.submittedAt).format("MMM D, YYYY h:mm A")}
                      >
                        {dayjs(r.submittedAt).fromNow()}
                      </time>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Page>
  );
}
