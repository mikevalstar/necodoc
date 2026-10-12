import { hasPermission } from "@necodoc/shared";
import { DotsThreeIcon, LinkIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { DensityToggle } from "@/components/data-table";
import { CopyButton } from "@/components/copy-button";
import { ErrorAlert } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dayjs } from "@/lib/date";
import { shareLinksQuery } from "@/lib/queries";
import {
  copyLink,
  publicLinkUrl,
  DeleteShareLinkDialog,
  LinkStateBadge,
  responseCount,
  ShareLinkDialog,
  type ShareLinkRow,
  useToggleShareLink,
  versionLabel,
} from "./-share-link-dialog";

// Spec: docs/features/share-links-and-data-requests.md. A publisher's own links.

export const Route = createFileRoute("/_app/share-links/")({
  beforeLoad: ({ context }) => {
    if (!hasPermission(context.me.user.roles, { document: ["publish"] }))
      throw redirect({ to: "/" });
  },
  component: ShareLinks,
});

function ShareLinks() {
  const links = useQuery(shareLinksQuery);
  const toggle = useToggleShareLink();
  const [editing, setEditing] = useState<ShareLinkRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ShareLinkRow | null>(null);
  const newLink = (
    <Button onClick={() => setEditing("new")}>
      <PlusIcon weight="bold" />
      New share link
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="Share links"
        description="Public links to a template for people without an account. Each response arrives as your document, with its PDF."
        actions={
          <>
            <FaqLink feature="Share links" />
            {links.data?.length !== 0 && newLink}
          </>
        }
      />

      <ErrorAlert error={links.error ?? toggle.error} />

      {links.isPending && <ListSkeleton />}
      {links.isSuccess && links.data.length === 0 && (
        <EmptyState
          icon={LinkIcon}
          title="No share links yet"
          description="Send a link to people outside necodoc. They answer the template's questions without an account, and each response lands in My documents."
          action={newLink}
        />
      )}
      {!!links.data?.length && (
        <Card className="gap-0 py-0">
          <div className="flex items-center gap-3 border-b border-hair px-4 py-3">
            <p className="text-sm text-ink-3">
              {links.data.length} {links.data.length === 1 ? "link" : "links"}
            </p>
            <div className="ml-auto">
              <DensityToggle />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Link</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responses</TableHead>
                <TableHead className="hidden md:table-cell">Views</TableHead>
                <TableHead className="hidden lg:table-cell">Expires</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.data.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="max-w-xs">
                    <Link
                      to="/share-links/$id"
                      params={{ id: link.id }}
                      className="block truncate font-semibold hover:underline"
                    >
                      {link.label}
                    </Link>
                    <p className="truncate text-xs text-ink-3">
                      {link.templateName} · {versionLabel(link).toLowerCase()}
                    </p>
                  </TableCell>
                  <TableCell>
                    <LinkStateBadge link={link} />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 tabular-nums">
                      {responseCount(link)}
                      {link.unseen > 0 && <Badge>{link.unseen} new</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">{link.views}</TableCell>
                  <TableCell className="hidden text-ink-2 lg:table-cell">
                    {link.expiresAt ? (
                      <span className="font-mono text-xs">
                        {dayjs(link.expiresAt).format("MMM D, YYYY")}
                      </span>
                    ) : (
                      "Never"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      <CopyButton
                        text={publicLinkUrl(link.token)}
                        label="Copy link"
                        className="hidden md:inline-flex"
                        aria-label={`Copy link for ${link.label}`}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${link.label}`}
                            />
                          }
                        >
                          <DotsThreeIcon weight="bold" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            render={<Link to="/share-links/$id" params={{ id: link.id }} />}
                          >
                            Open responses
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void copyLink(link.token)}>
                            Copy link
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditing(link)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              toggle.mutate({ id: link.id, disabled: !link.disabledAt })
                            }
                          >
                            {link.disabledAt ? "Enable" : "Disable"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(link)}>
                            Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {editing && (
        <ShareLinkDialog
          link={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && <DeleteShareLinkDialog link={deleting} onClose={() => setDeleting(null)} />}
    </Page>
  );
}
