import { createTemplateSchema, hasPermission } from "@necodoc/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { ErrorAlert, useAppForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";
import {
  DeleteTemplateDialog,
  TemplateStatusBadges,
  templateStatus,
  templateStatuses,
  useArchiveTemplate,
  useDuplicateTemplate,
} from "./-template-actions";

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md. The API
// lists only published, non-archived templates to users who can't see drafts.
const statusSchema = z.enum(["draft", "published", "changes", "archived"]);

const searchSchema = z.object({
  q: z.string().optional(),
  status: statusSchema.optional(),
});

export const Route = createFileRoute("/_app/templates/")({
  validateSearch: searchSchema,
  component: Templates,
});

function Templates() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const can = (action: "create" | "edit" | "review" | "publish") =>
    hasPermission(me.user.roles, { document: [action] });
  const seesDrafts = can("edit") || can("review") || can("publish");
  const templates = useQuery(templatesQuery);
  const duplicate = useDuplicateTemplate();
  const archive = useArchiveTemplate();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState(search.q ?? "");
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);

  const rows = (templates.data ?? []).filter((t) => {
    // Archived templates only show when asked for.
    const status = templateStatus(t);
    if (search.status ? status !== search.status : status === "archived") return false;
    const text = `${t.name} ${t.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground">
            {seesDrafts
              ? "Documents designed once and filled in many times. Edit the draft, publish a version."
              : "Published templates you can fill in."}
          </p>
        </div>
        {can("create") && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            New template
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-64">
          <FieldLabel htmlFor="template-search">Search</FieldLabel>
          <Input
            id="template-search"
            type="search"
            placeholder="Name or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => navigate({ search: { ...search, q: query || undefined }, replace: true })}
          />
        </Field>
        {seesDrafts && (
          <Field className="w-auto">
            <FieldLabel htmlFor="template-status">Status</FieldLabel>
            <NativeSelect
              id="template-status"
              value={search.status ?? ""}
              onChange={(e) =>
                navigate({
                  search: { ...search, status: statusSchema.safeParse(e.target.value).data },
                })
              }
            >
              <NativeSelectOption value="">All but archived</NativeSelectOption>
              {statusSchema.options.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {templateStatuses[status]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>

      <ErrorAlert error={templates.error ?? duplicate.error ?? archive.error} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">
              {seesDrafts ? "Draft saved" : "Published"}
            </TableHead>
            <TableHead className="w-0">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="max-w-md">
                {seesDrafts ? (
                  <Link
                    to="/templates/$id"
                    params={{ id: t.id }}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                ) : (
                  <span className="font-medium">{t.name}</span>
                )}
                {t.description && (
                  <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                )}
              </TableCell>
              <TableCell>
                <TemplateStatusBadges template={t} />
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {dayjs(seesDrafts ? t.updatedAt : (t.publishedAt ?? t.updatedAt)).fromNow()}
              </TableCell>
              <TableCell>
                {seesDrafts && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${t.name}`}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem render={<Link to="/templates/$id" params={{ id: t.id }} />}>
                        {can("edit") ? "Edit" : "Open"}
                      </DropdownMenuItem>
                      {can("create") && (
                        <DropdownMenuItem onClick={() => duplicate.mutate(t.id)}>
                          Duplicate
                        </DropdownMenuItem>
                      )}
                      {can("publish") && (
                        <DropdownMenuItem
                          onClick={() => archive.mutate({ id: t.id, archive: !t.archivedAt })}
                        >
                          {t.archivedAt ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                      )}
                      {can("edit") && t.latestVersion === null && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(t)}>
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
          {templates.isSuccess && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                {templates.data.length === 0
                  ? seesDrafts
                    ? "No templates yet."
                    : "Nothing has been published yet."
                  : "No templates match."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {creating && <CreateTemplateDialog onClose={() => setCreating(false)} />}
      {deleting && <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />}
    </main>
  );
}

const createSchema = z.object({
  name: createTemplateSchema.options[0].shape.name,
  description: z.string().max(2000),
});

/** Designed templates only for now; PDF overlay templates come with their own flow. */
function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async (json: z.infer<typeof createSchema>) =>
      (await ok(api.templates.$post({ json: { kind: "designed", ...json } }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });
      await navigate({ to: "/templates/$id", params: { id: created.id } });
    },
  });
  const form = useAppForm({
    defaultValues: { name: "", description: "" },
    validators: { onChange: createSchema },
    onSubmit: ({ value }) => create.mutate(value),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              Design a document from scratch: content, header and footer, and the fields it needs.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" autoFocus placeholder="Surety bond certificate" />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => <field.TextareaField label="Description (optional)" rows={3} />}
            </form.AppField>
          </FieldGroup>
          <ErrorAlert error={create.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Create and open
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
