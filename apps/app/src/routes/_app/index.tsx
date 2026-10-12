import { submissionSourceSchema, submissionStatusSchema } from "@necodoc/shared";
import { DotsThreeIcon, FileTextIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { DensityToggle } from "@/components/data-table";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { submissionPdfUrl } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { submissionsQuery } from "@/lib/queries";
import { GetStarted, setsUpNecodoc } from "./-get-started";
import {
  DeleteDocumentDialog,
  DocumentStatusBadge,
  useStartDocument,
} from "./documents/-document-actions";

// Spec: docs/features/filling-out-a-document.md. "My documents": what the user filled in, plus
// responses to their share links (also listed per link, share-links/$id).

const searchSchema = z.object({
  q: z.string().optional(),
  status: submissionStatusSchema.optional(),
  source: submissionSourceSchema.optional(),
});

export const Route = createFileRoute("/_app/")({
  validateSearch: searchSchema,
  component: Documents,
});

function Documents() {
  const { me } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const documents = useQuery(submissionsQuery({ source: search.source, status: search.status }));
  const start = useStartDocument();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState(search.q ?? "");
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (documents.data ?? []).filter((d) => {
    const text = `${d.name} ${d.templateName}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  // Nothing at all yet (not just filtered away): show the next step instead of an empty table.
  const empty =
    documents.isSuccess && documents.data.length === 0 && !search.status && !search.source;

  return (
    <Page>
      <PageHeader
        title="My documents"
        description="Answer a template's questions and get the finished PDF. Drafts save as you type."
        actions={
          <>
            <FaqLink feature="Filling out a document" />
            <Button nativeButton={false} render={<Link to="/documents/new" />}>
              <PlusIcon weight="bold" />
              New document
            </Button>
          </>
        }
      />

      {setsUpNecodoc(me.user.roles) && <GetStarted me={me} />}

      {empty ? (
        <EmptyState
          icon={FileTextIcon}
          title="No documents yet"
          description="Pick a template to fill in. You answer its questions step by step and download the finished PDF."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/documents/new" />}>
              <PlusIcon weight="bold" />
              Pick a template
            </Button>
          }
        />
      ) : (
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-end gap-3 border-b border-hair px-4 py-3.5">
            <Field className="w-full sm:w-64">
              <FieldLabel htmlFor="document-search">Search</FieldLabel>
              <Input
                id="document-search"
                type="search"
                placeholder="Name or template"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() =>
                  navigate({ search: { ...search, q: query || undefined }, replace: true })
                }
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="document-status">Status</FieldLabel>
              <NativeSelect
                id="document-status"
                value={search.status ?? ""}
                onChange={(e) =>
                  navigate({
                    search: {
                      ...search,
                      status: submissionStatusSchema.safeParse(e.target.value).data,
                    },
                  })
                }
              >
                <NativeSelectOption value="">All</NativeSelectOption>
                <NativeSelectOption value="draft">Drafts</NativeSelectOption>
                <NativeSelectOption value="finished">Finished</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="document-source">From</FieldLabel>
              <NativeSelect
                id="document-source"
                value={search.source ?? ""}
                onChange={(e) =>
                  navigate({
                    search: {
                      ...search,
                      source: submissionSourceSchema.safeParse(e.target.value).data,
                    },
                  })
                }
              >
                <NativeSelectOption value="">Anywhere</NativeSelectOption>
                <NativeSelectOption value="app">Filled by me</NativeSelectOption>
                <NativeSelectOption value="share_link">Share links</NativeSelectOption>
              </NativeSelect>
            </Field>
            <div className="ml-auto">
              <DensityToggle />
            </div>
          </div>

          {(documents.error ?? start.error) && (
            <div className="px-4 pt-4">
              <ErrorAlert error={documents.error ?? start.error} />
            </div>
          )}

          {documents.isPending ? (
            <ListSkeleton className="p-4" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Last edited</TableHead>
                  <TableHead className="w-0 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-md pl-4">
                      <Link
                        to="/documents/$id"
                        params={{ id: d.id }}
                        className="block truncate font-semibold hover:underline"
                      >
                        {d.name}
                      </Link>
                      <p className="truncate text-xs text-ink-3">
                        {d.templateName} · version {d.version}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <DocumentStatusBadge
                          status={d.status}
                          generationStatus={d.generationStatus}
                        />
                        {d.source === "share_link" && <Badge variant="secondary">Share link</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-ink-3 sm:table-cell">
                      {dayjs(d.updatedAt).fromNow()}
                    </TableCell>
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${d.name}`}
                            />
                          }
                        >
                          <DotsThreeIcon weight="bold" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            render={<Link to="/documents/$id" params={{ id: d.id }} />}
                          >
                            {d.status === "draft" ? "Continue" : "Open"}
                          </DropdownMenuItem>
                          {d.generationStatus === "success" && (
                            <DropdownMenuItem
                              render={<a href={`${submissionPdfUrl(d.id)}?download=1`} />}
                            >
                              Download PDF
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() =>
                              start.mutate({ templateId: d.templateId, fromSubmissionId: d.id })
                            }
                          >
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            render={<Link to="/documents/new" search={{ from: d.id }} />}
                          >
                            Reuse answers in another template
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(d)}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {documents.isSuccess && rows.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="h-24 text-center text-ink-3">
                      No documents match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {deleting && <DeleteDocumentDialog document={deleting} onClose={() => setDeleting(null)} />}
    </Page>
  );
}
