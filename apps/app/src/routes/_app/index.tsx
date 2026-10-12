import { submissionSourceSchema, submissionStatusSchema } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">My documents</h1>
          <p className="text-sm text-muted-foreground">
            Answer a template's questions and get the finished PDF. Drafts save as you type.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/documents/new" />}>
          <PlusIcon />
          New document
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full sm:w-64">
          <FieldLabel htmlFor="document-search">Search</FieldLabel>
          <Input
            id="document-search"
            type="search"
            placeholder="Name or template"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => navigate({ search: { ...search, q: query || undefined }, replace: true })}
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
      </div>

      <ErrorAlert error={documents.error ?? start.error} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Last edited</TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="max-w-md">
                <Link
                  to="/documents/$id"
                  params={{ id: d.id }}
                  className="block truncate font-medium hover:underline"
                >
                  {d.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {d.templateName} · version {d.version}
                </p>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  <DocumentStatusBadge status={d.status} generationStatus={d.generationStatus} />
                  {d.source === "share_link" && <Badge variant="outline">Share link</Badge>}
                </span>
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {dayjs(d.updatedAt).fromNow()}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.name}`} />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem render={<Link to="/documents/$id" params={{ id: d.id }} />}>
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
                    <DropdownMenuItem render={<Link to="/documents/new" search={{ from: d.id }} />}>
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
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                {documents.data.length === 0 ? (
                  <>
                    No documents yet.{" "}
                    <Link to="/documents/new" className="underline underline-offset-4">
                      Start one
                    </Link>
                    .
                  </>
                ) : (
                  "No documents match."
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {deleting && <DeleteDocumentDialog document={deleting} onClose={() => setDeleting(null)} />}
    </main>
  );
}
