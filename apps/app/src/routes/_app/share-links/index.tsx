import { hasPermission } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
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
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { shareLinksQuery } from "@/lib/queries";
import {
  LinkStateBadge,
  publicLinkUrl,
  ShareLinkDialog,
  type ShareLinkRow,
  useToggleShareLink,
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

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Share links</h1>
          <p className="text-sm text-muted-foreground">
            Public links to a template for people without an account. Each response arrives as your
            document, with its PDF.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          New share link
        </Button>
      </div>

      <ErrorAlert error={links.error ?? toggle.error} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Link</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Responses</TableHead>
            <TableHead className="hidden md:table-cell">Link address</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.data?.map((link) => (
            <TableRow key={link.id}>
              <TableCell className="max-w-xs">
                <Link
                  to="/share-links/$id"
                  params={{ id: link.id }}
                  className="block truncate font-medium hover:underline"
                >
                  {link.label}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {link.templateName} ·{" "}
                  {link.version === null ? "latest version" : `version ${link.version}`}
                  {link.expiresAt && ` · until ${dayjs(link.expiresAt).format("MMM D, YYYY")}`}
                </p>
              </TableCell>
              <TableCell>
                <LinkStateBadge link={link} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  {link.submissions}
                  {link.maxSubmissions !== null && ` / ${link.maxSubmissions}`}
                  {link.unseen > 0 && <Badge>{link.unseen} new</Badge>}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <CopyButton text={publicLinkUrl(link.token)} label="Copy link" />
              </TableCell>
              <TableCell>
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
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={<Link to="/share-links/$id" params={{ id: link.id }} />}
                    >
                      Responses
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigator.clipboard.writeText(publicLinkUrl(link.token))}
                    >
                      Copy link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setEditing(link)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => toggle.mutate({ id: link.id, disabled: !link.disabledAt })}
                    >
                      {link.disabledAt ? "Enable" : "Disable"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(link)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {links.isSuccess && links.data.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                No share links yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editing && (
        <ShareLinkDialog
          link={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && <DeleteShareLinkDialog link={deleting} onClose={() => setDeleting(null)} />}
    </main>
  );
}

function DeleteShareLinkDialog({ link, onClose }: { link: ShareLinkRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => ok(api["share-links"][":id"].$delete({ param: { id: link.id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shareLinksQuery.queryKey });
      onClose();
    },
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {link.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            The link stops working at once. Its {link.submissions} responses stay in your documents.
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
