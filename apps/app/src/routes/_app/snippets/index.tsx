import { createSnippetSchema, hasPermission, snippetKeySchema } from "@necodoc/shared";
import { MagnifyingGlassIcon, PlusIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { activeFilter, DebouncedInput, DensityToggle, FilterSelect } from "@/components/data-table";
import { snippetText } from "@/components/editor/snippet";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
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
import { requireAccess } from "@/lib/auth";
import { dayjs } from "@/lib/date";
import { snippetsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Spec: docs/features/snippet-library.md. Everyone who opens template drafts can browse snippets.

const searchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  archived: z.boolean().optional(),
});

export const Route = createFileRoute("/_app/snippets/")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => requireAccess(context.me, ["create", "edit", "review", "publish"]),
  component: Snippets,
});

function Snippets() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const canCreate = hasPermission(me.user.roles, { document: ["create"] });
  const snippets = useQuery(snippetsQuery);
  const [creating, setCreating] = useState(false);
  const words = (search.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  const all = snippets.data ?? [];
  const archivedCount = all.filter((s) => s.archivedAt).length;
  const tags = [...new Set(all.flatMap((s) => s.tags))].sort();
  const rows = all.filter((s) => {
    if (Boolean(s.archivedAt) !== Boolean(search.archived)) return false;
    if (search.tag && !s.tags.includes(search.tag)) return false;
    const text = `${s.name} ${s.key} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const newSnippet = canCreate && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon weight="bold" />
      New snippet
    </Button>
  );

  return (
    <Page>
      <PageHeader
        title="Snippets"
        description="Clauses, disclaimers and signature blocks written once and used in many templates."
        actions={
          <>
            <FaqLink feature="Snippet library" />
            {all.length > 0 && newSnippet}
          </>
        }
      />

      <ErrorAlert error={snippets.error} />

      {snippets.isPending ? (
        <ListSkeleton />
      ) : all.length === 0 ? (
        snippets.isSuccess && (
          <EmptyState
            icon={PuzzlePieceIcon}
            title="No snippets yet"
            description="Write a clause once, then insert it into any template from the editor's Insert menu. Editing the snippet updates every draft that uses it."
            action={newSnippet}
          />
        )
      ) : (
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <DebouncedInput
                type="search"
                aria-label="Search snippets"
                className={cn("pl-9", search.q && activeFilter)}
                placeholder="Name, key, description or tag"
                value={search.q ?? ""}
                onCommit={(q) =>
                  navigate({ search: { ...search, q: q || undefined }, replace: true })
                }
              />
            </div>
            {tags.length > 0 && (
              <FilterSelect
                label="Tag"
                value={search.tag}
                options={tags.map((tag) => ({ value: tag, label: tag }))}
                onChange={(tag) => navigate({ search: { ...search, tag: tag || undefined } })}
              />
            )}
            <Tabs
              value={search.archived ? "archived" : "active"}
              onValueChange={(value) =>
                navigate({ search: { ...search, archived: value === "archived" || undefined } })
              }
            >
              <TabsList aria-label="Show">
                <TabsTrigger value="active" className="h-8 flex-none">
                  Active
                  <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                    {all.length - archivedCount}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="archived" className="h-8 flex-none">
                  Archived
                  <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                    {archivedCount}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[13px] text-ink-3" aria-live="polite">
                {rows.length} {rows.length === 1 ? "snippet" : "snippets"}
              </span>
              <DensityToggle />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead className="hidden lg:table-cell">Content</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Saved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-xs pl-4">
                    <Link
                      to="/snippets/$id"
                      params={{ id: s.id }}
                      className="block truncate font-semibold hover:underline"
                    >
                      {s.name}
                    </Link>
                    <p className="truncate text-xs text-ink-3">
                      <code className="font-mono">{s.key}</code>
                      {s.description && ` · ${s.description}`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-md lg:table-cell">
                    <p className="line-clamp-2 text-[13px] whitespace-normal text-ink-2">
                      {snippetText(s.content)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {s.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell
                    className="hidden pr-4 text-ink-2 sm:table-cell"
                    title={dayjs(s.updatedAt).format("MMM D, YYYY h:mm A")}
                  >
                    {dayjs(s.updatedAt).fromNow()}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-ink-3">
                    {search.archived && archivedCount === 0
                      ? "No archived snippets."
                      : "No snippets match these filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {creating && <CreateSnippetDialog onClose={() => setCreating(false)} />}
    </Page>
  );
}

/** A key from a name: "Surety indemnity clause" → "surety-indemnity-clause". */
const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 64);

const createSchema = z.object({
  name: createSnippetSchema.shape.name,
  key: z.union([snippetKeySchema, z.literal("")]),
  description: z.string().max(2000),
});

function CreateSnippetDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async ({ key, ...json }: z.infer<typeof createSchema>) =>
      (await ok(api.snippets.$post({ json: { ...json, key: key || keyFrom(json.name) } }))).json(),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey });
      await navigate({ to: "/snippets/$id", params: { id: created.id } });
    },
  });
  const form = useAppForm({
    defaultValues: { name: "", key: "", description: "" },
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
            <DialogTitle>New snippet</DialogTitle>
            <DialogDescription>
              The key is how code templates and API HTML include it:{" "}
              <code className="font-mono text-xs">{"{% render 'key' %}"}</code>. It can't change
              later.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => (
                <field.TextField label="Name" autoFocus placeholder="Surety indemnity clause" />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.name}>
              {(name) => (
                <form.AppField name="key">
                  {(field) => (
                    <field.TextField
                      label="Key (optional)"
                      placeholder={keyFrom(name) || "surety-indemnity"}
                    />
                  )}
                </form.AppField>
              )}
            </form.Subscribe>
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
