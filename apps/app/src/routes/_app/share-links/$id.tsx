import { hasPermission } from "@necodoc/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HistoryPanel } from "@/components/audit";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert } from "@/components/form";
import { BackLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok, submissionPdfUrl } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { shareLinksQuery } from "@/lib/queries";
import { DocumentStatusBadge } from "../documents/-document-actions";
import {
  LinkStateBadge,
  publicLinkUrl,
  ShareLinkDialog,
  useToggleShareLink,
} from "./-share-link-dialog";

// Spec: docs/features/share-links-and-data-requests.md. One link and its responses; opening
// this page marks them seen.

export const Route = createFileRoute("/_app/share-links/$id")({
  beforeLoad: ({ context }) => {
    if (!hasPermission(context.me.user.roles, { document: ["publish"] }))
      throw redirect({ to: "/" });
  },
  component: ShareLinkResponses,
});

function ShareLinkResponses() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["share-links", id],
    queryFn: async () => (await ok(api["share-links"][":id"].$get({ param: { id } }))).json(),
  });
  const toggle = useToggleShareLink();
  const [editing, setEditing] = useState(false);
  // The API marked the responses seen; refresh the list counts and the nav badge.
  useEffect(() => {
    if (detail.dataUpdatedAt) {
      void queryClient.invalidateQueries({ queryKey: shareLinksQuery.queryKey, exact: true });
    }
  }, [detail.dataUpdatedAt, queryClient]);
  const link = detail.data?.link;
  const submissions = detail.data?.submissions ?? [];

  return (
    <Page>
      <ErrorAlert error={detail.error ?? toggle.error} />
      {detail.isPending && <ListSkeleton rows={3} />}
      {link && (
        <>
          <PageHeader
            title={link.label}
            back={<BackLink to="/share-links">Share links</BackLink>}
            description={
              <>
                {link.templateName} ·{" "}
                {link.version === null ? "latest version" : `version ${link.version}`} ·{" "}
                {link.submissions}
                {link.maxSubmissions !== null && ` of ${link.maxSubmissions}`}{" "}
                {link.submissions === 1 && link.maxSubmissions === null ? "response" : "responses"}
                {link.expiresAt && ` · expires ${dayjs(link.expiresAt).format("MMM D, YYYY")}`}
                {link.requireEmail && " · asks for email"}
                {link.allowDownload ? " · filler can download" : " · no download for the filler"}
              </>
            }
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate(
                      { id: link.id, disabled: !link.disabledAt },
                      { onSuccess: () => detail.refetch() },
                    )
                  }
                >
                  {link.disabledAt ? "Enable" : "Disable"}
                </Button>
                <CopyButton text={publicLinkUrl(link.token)} label="Copy link" />
              </>
            }
          >
            <LinkStateBadge link={link} />
          </PageHeader>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {publicLinkUrl(link.token)}
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Response</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">PDF</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-md">
                    <Link
                      to="/documents/$id"
                      params={{ id: s.id }}
                      className="block truncate font-medium hover:underline"
                    >
                      {s.respondentEmail ?? s.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">version {s.version}</p>
                  </TableCell>
                  <TableCell>
                    <DocumentStatusBadge status={s.status} generationStatus={s.generationStatus} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {dayjs(s.createdAt).format("MMM D, YYYY h:mm A")}
                  </TableCell>
                  <TableCell>
                    {s.generationStatus === "success" && (
                      <a
                        href={submissionPdfUrl(s.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline underline-offset-4"
                      >
                        PDF
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {submissions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No responses yet. Copy the link above and send it to the people who should fill
                    it in.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {editing && (
            <ShareLinkDialog
              link={link}
              onClose={() => {
                setEditing(false);
                void detail.refetch();
              }}
            />
          )}
        </>
      )}
      <HistoryPanel targetType="share_link" targetId={id} />
    </Page>
  );
}
