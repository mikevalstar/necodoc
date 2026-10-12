import { hasPermission } from "@necodoc/shared";
import { ArrowSquareOutIcon, CopyIcon, FilePdfIcon, TrayIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { HistoryPanel } from "@/components/audit";
import { CopyButton } from "@/components/copy-button";
import { DensityToggle } from "@/components/data-table";
import { ErrorAlert } from "@/components/form";
import { BackLink, EmptyState, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ok, submissionPdfUrl } from "@/lib/api";
import { usePageCrumb } from "@/lib/breadcrumb";
import { dayjs } from "@/lib/date";
import { shareLinksQuery } from "@/lib/queries";
import { DocumentStatusBadge } from "../documents/-document-actions";
import {
  copyLink,
  DeleteShareLinkDialog,
  LinkStateBadge,
  publicLinkUrl,
  responseCount,
  ShareLinkDialog,
  useToggleShareLink,
  versionLabel,
} from "./-share-link-dialog";

// Spec: docs/features/share-links-and-data-requests.md. One link, its settings and its
// responses; opening this page marks them seen.

export const Route = createFileRoute("/_app/share-links/$id")({
  beforeLoad: ({ context }) => {
    if (!hasPermission(context.me.user.roles, { document: ["publish"] }))
      throw redirect({ to: "/" });
  },
  component: ShareLinkResponses,
});

function ShareLinkResponses() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["share-links", id],
    queryFn: async () => (await ok(api["share-links"][":id"].$get({ param: { id } }))).json(),
  });
  const toggle = useToggleShareLink();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The API marked the responses seen; refresh the list counts and the nav badge.
  useEffect(() => {
    if (detail.dataUpdatedAt) {
      void queryClient.invalidateQueries({ queryKey: shareLinksQuery.queryKey, exact: true });
    }
  }, [detail.dataUpdatedAt, queryClient]);
  const link = detail.data?.link;
  usePageCrumb(link?.label);
  const submissions = detail.data?.submissions ?? [];
  // When they were last seen before this visit, so refetches (which mark them seen again)
  // don't clear the "New" pills while the page is open.
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  if (link && seenBefore === null) setSeenBefore(link.seenAt);

  const back = <BackLink to="/share-links">Share links</BackLink>;
  if (detail.isError) {
    return (
      <Page>
        {back}
        <ErrorAlert error={detail.error} />
      </Page>
    );
  }
  if (!link) {
    return (
      <Page>
        {back}
        <ListSkeleton rows={4} />
      </Page>
    );
  }

  const url = publicLinkUrl(link.token);
  // Over the responses since views started counting (older links have responses from before).
  const conversion = link.views ? Math.round((link.viewedSubmissions / link.views) * 100) : null;
  const prefilled = Object.keys(link.prefill).length;
  const expired = link.expiresAt !== null && dayjs(link.expiresAt).isBefore(dayjs());

  return (
    <Page>
      <PageHeader
        title={link.label}
        back={back}
        description={`${link.templateName} · ${versionLabel(link)}`}
        actions={
          <>
            <Button variant="destructive" onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button
              variant="outline"
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
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button onClick={() => void copyLink(link.token)}>
              <CopyIcon />
              Copy link
            </Button>
          </>
        }
      >
        <LinkStateBadge link={link} />
      </PageHeader>

      <ErrorAlert error={toggle.error} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Responses" value={responseCount(link)}>
          {link.unseen > 0 && <Badge>{link.unseen} new</Badge>}
        </Stat>
        <Stat label="Views" value={String(link.views)} />
        <Stat
          label="Conversion"
          value={conversion === null ? "–" : `${conversion}%`}
          hint={conversion === null ? "No views yet" : "Responses per view"}
        />
        <Stat
          label={expired ? "Expired" : "Expires"}
          value={link.expiresAt ? dayjs(link.expiresAt).format("MMM D, YYYY") : "Never"}
          hint={link.expiresAt ? dayjs(link.expiresAt).fromNow() : "No end date"}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-hair py-3.5">
            <CardTitle>Responses</CardTitle>
            {submissions.length > 0 && (
              <CardAction>
                <DensityToggle />
              </CardAction>
            )}
          </CardHeader>
          {submissions.length === 0 ? (
            <EmptyState
              icon={TrayIcon}
              title="No responses yet"
              description="Copy the link and send it to the people who should fill it in. Each response shows up here and in My documents."
              className="border-0 py-12"
            />
          ) : (
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
                      <span className="flex min-w-0 items-center gap-2">
                        <Link
                          to="/documents/$id"
                          params={{ id: s.id }}
                          className="truncate font-semibold hover:underline"
                        >
                          {s.respondentEmail ?? s.name}
                        </Link>
                        {seenBefore !== null && dayjs(s.createdAt).isAfter(seenBefore) && (
                          <Badge>New</Badge>
                        )}
                      </span>
                      <p className="text-xs text-ink-3">Version {s.version}</p>
                    </TableCell>
                    <TableCell>
                      <DocumentStatusBadge
                        status={s.status}
                        generationStatus={s.generationStatus}
                      />
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-ink-2 sm:table-cell">
                      {dayjs(s.createdAt).format("MMM D, YYYY h:mm A")}
                    </TableCell>
                    <TableCell>
                      {s.generationStatus === "success" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={
                            <a
                              href={submissionPdfUrl(s.id)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`PDF for ${s.respondentEmail ?? s.name}`}
                            />
                          }
                        >
                          <FilePdfIcon />
                          PDF
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Link</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="rounded-lg bg-tint px-3 py-2.5 font-mono text-xs break-all text-ink-2">
                {url}
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={url} label="Copy" />
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href={url} target="_blank" rel="noreferrer" />}
                >
                  <ArrowSquareOutIcon />
                  Open
                </Button>
              </div>
              <p className="text-xs text-ink-3">
                Add <code className="font-mono">?field_key=value</code> to prefill an unlocked
                answer for one recipient. Opening the link counts as a view.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardAction>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-hair">
                <Meta label="Template">{link.templateName}</Meta>
                <Meta label="Version">
                  {link.version === null ? "Latest (follows new versions)" : link.version}
                </Meta>
                <Meta label="Limit">
                  {link.maxSubmissions === null
                    ? "No limit"
                    : `${link.maxSubmissions} ${link.maxSubmissions === 1 ? "response" : "responses"}`}
                </Meta>
                <Meta label="Expires">
                  {link.expiresAt ? dayjs(link.expiresAt).format("MMM D, YYYY h:mm A") : "Never"}
                </Meta>
                <Meta label="Filler email">{link.requireEmail ? "Required" : "Not asked"}</Meta>
                <Meta label="PDF download">{link.allowDownload ? "Allowed" : "Off"}</Meta>
                <Meta label="Prefilled">
                  {prefilled === 0
                    ? "None"
                    : `${prefilled} ${prefilled === 1 ? "answer" : "answers"}${
                        link.lockedKeys.length ? `, ${link.lockedKeys.length} locked` : ""
                      }`}
                </Meta>
                <Meta label="Created">{dayjs(link.createdAt).format("MMM D, YYYY")}</Meta>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <HistoryPanel targetType="share_link" targetId={id} />

      {editing && (
        <ShareLinkDialog
          link={link}
          onClose={() => {
            setEditing(false);
            void detail.refetch();
          }}
        />
      )}
      {deleting && (
        <DeleteShareLinkDialog
          link={link}
          onClose={() => setDeleting(false)}
          onDeleted={() => void navigate({ to: "/share-links" })}
        />
      )}
    </Page>
  );
}

function Stat({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="text-xs font-semibold text-ink-3">{label}</p>
        <p className="flex items-center gap-2">
          <span className="font-heading text-2xl leading-none lg:text-[28px] font-extrabold tabular-nums">
            {value}
          </span>
          {children}
        </p>
        {hint && <p className="text-xs text-ink-3">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
