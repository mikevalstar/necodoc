import { createSnippetSchema, hasPermission, snippetKeySchema } from "@necodoc/shared";
import { PlusIcon, PuzzlePieceIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { snippetText } from "@/components/editor/snippet";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
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
import { snippetsQuery } from "@/lib/queries";

// Spec: docs/features/snippet-library.md. Everyone who opens template drafts can browse snippets.

const searchSchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  archived: z.boolean().optional(),
});

export const Route = createFileRoute("/_app/snippets/")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const sees = (["create", "edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!sees) throw redirect({ to: "/" });
  },
  component: Snippets,
});

function Snippets() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const canCreate = hasPermission(me.user.roles, { document: ["create"] });
  const snippets = useQuery(snippetsQuery);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState(search.q ?? "");
  const words = useDeferredValue(query).toLowerCase().split(/\s+/).filter(Boolean);

  const all = snippets.data ?? [];
  const tags = [...new Set(all.flatMap((s) => s.tags))].sort();
  const rows = all.filter((s) => {
    if (Boolean(s.archivedAt) !== Boolean(search.archived)) return false;
    if (search.tag && !s.tags.includes(search.tag)) return false;
    const text = `${s.name} ${s.key} ${s.description} ${s.tags.join(" ")}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  return (
    <Page>
      <PageHeader
        title="Snippets"
        description="Clauses, disclaimers and signature blocks written once and used in many templates."
        actions={
          <>
            <FaqLink feature="Snippet library" />
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon weight="bold" />
                New snippet
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full sm:w-64">
          <FieldLabel htmlFor="snippet-search">Search</FieldLabel>
          <Input
            id="snippet-search"
            type="search"
            placeholder="Name, key, description or tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => navigate({ search: { ...search, q: query || undefined }, replace: true })}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="snippet-tag">Tag</FieldLabel>
          <NativeSelect
            id="snippet-tag"
            value={search.tag ?? ""}
            onChange={(e) => navigate({ search: { ...search, tag: e.target.value || undefined } })}
          >
            <NativeSelectOption value="">Any tag</NativeSelectOption>
            {tags.map((tag) => (
              <NativeSelectOption key={tag} value={tag}>
                {tag}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="snippet-archived">Show</FieldLabel>
          <NativeSelect
            id="snippet-archived"
            value={search.archived ? "archived" : ""}
            onChange={(e) =>
              navigate({
                search: { ...search, archived: e.target.value === "archived" || undefined },
              })
            }
          >
            <NativeSelectOption value="">Active</NativeSelectOption>
            <NativeSelectOption value="archived">Archived</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>

      <ErrorAlert error={snippets.error} />

      {snippets.isPending ? (
        <ListSkeleton />
      ) : all.length === 0 ? (
        <EmptyState
          icon={PuzzlePieceIcon}
          title="No snippets yet"
          description="Write a clause once, then insert it into any template from the editor's Insert menu. Editing the snippet updates every draft that uses it."
          action={
            canCreate && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon weight="bold" />
                New snippet
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Content</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="hidden sm:table-cell">Saved</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="max-w-xs">
                  <Link
                    to="/snippets/$id"
                    params={{ id: s.id }}
                    className="font-medium hover:underline"
                  >
                    {s.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    <code>{s.key}</code>
                    {s.description && ` · ${s.description}`}
                  </p>
                </TableCell>
                <TableCell className="hidden max-w-md md:table-cell">
                  <p className="line-clamp-2 text-xs whitespace-normal text-muted-foreground">
                    {snippetText(s.content)}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {s.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {dayjs(s.updatedAt).fromNow()}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No snippets match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
              The key is how code templates and API HTML include it: {"{% render 'key' %}"}. It
              can't change later.
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
