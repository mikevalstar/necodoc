import { createTemplateSchema, hasPermission } from "@necodoc/shared";
import { DotsThreeIcon, FileTextIcon, PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { useAiEnabled } from "@/components/ai";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";
import { uploadPdfSource } from "./-overlay-editor";
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
  /** Opens the New template dialog on that kind: the first-run links ("upload a PDF"). */
  new: z.enum(["designed", "overlay"]).optional(),
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
  const [creating, setCreating] = useState<Kind | null>(
    can("create") ? (search.new ?? null) : null,
  );
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
    <Page>
      <PageHeader
        title="Templates"
        description={
          seesDrafts
            ? "Documents designed once and filled in many times. Edit the draft, publish a version."
            : "Published templates you can fill in."
        }
        actions={
          <>
            <FaqLink feature="Designed templates" />
            {can("create") && (
              <Button onClick={() => setCreating("designed")}>
                <PlusIcon weight="bold" />
                New template
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full sm:w-64">
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

      {templates.isPending ? (
        <ListSkeleton />
      ) : templates.data?.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title={seesDrafts ? "No templates yet" : "Nothing published yet"}
          description={
            can("create")
              ? "Design a document from scratch, or upload a PDF you already use and place the answers on it."
              : "Templates appear here once someone publishes one."
          }
          action={
            can("create") && (
              <>
                <Button onClick={() => setCreating("designed")}>
                  <PlusIcon weight="bold" />
                  Design a template
                </Button>
                <Button variant="outline" onClick={() => setCreating("overlay")}>
                  <UploadSimpleIcon />
                  Upload a PDF
                </Button>
              </>
            )
          }
        />
      ) : (
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
                  {/* Draft state is editors' business; viewers see the published version. */}
                  <TemplateStatusBadges
                    template={seesDrafts ? t : { ...t, hasUnpublishedChanges: false }}
                  />
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
                        <DotsThreeIcon weight="bold" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          render={<Link to="/templates/$id" params={{ id: t.id }} />}
                        >
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
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No templates match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {creating && (
        <CreateTemplateDialog
          initialKind={creating}
          onClose={() => {
            setCreating(null);
            if (search.new) navigate({ search: { ...search, new: undefined }, replace: true });
          }}
        />
      )}
      {deleting && <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />}
    </Page>
  );
}

const createSchema = z.object({
  name: createTemplateSchema.options[0].shape.name,
  description: z.string().max(2000),
});

type Kind = "designed" | "overlay" | "ai";
const kinds = ["designed", "overlay", "ai"] as const satisfies readonly Kind[];
const isKind = (value: string): value is Kind => (kinds as readonly string[]).includes(value);

/** What the assistant is asked when a template is created from a description. */
const buildSchema = z
  .string()
  .trim()
  .min(10, "Describe the document in a sentence or more")
  .max(4000);

/**
 * A designed template from scratch, an overlay template on an uploaded PDF, or (AI on) a designed
 * template the assistant builds from a description (docs/features/ai-template-assistant.md).
 */
function CreateTemplateDialog({
  initialKind,
  onClose,
}: {
  initialKind: Kind;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const aiEnabled = useAiEnabled();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const build = buildSchema.safeParse(prompt);
  const createFromDescription = useMutation({
    mutationFn: async (_text: string) =>
      (await ok(api.templates.$post({ json: { kind: "designed", name: "New template" } }))).json(),
    onSuccess: async (created, text) => {
      await queryClient.invalidateQueries({ queryKey: templatesQuery.queryKey });
      await navigate({ to: "/templates/$id", params: { id: created.id }, search: { build: text } });
    },
  });
  const create = useMutation({
    mutationFn: async (json: z.infer<typeof createSchema>) => {
      if (kind === "designed") {
        return (await ok(api.templates.$post({ json: { kind: "designed", ...json } }))).json();
      }
      if (!file) throw new Error("Pick the PDF to fill");
      const source = await uploadPdfSource(file);
      return (
        await ok(
          api.templates.$post({
            json: { kind: "overlay", ...json, content: { sourceId: source.id } },
          }),
        )
      ).json();
    },
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
            if (kind !== "ai") form.handleSubmit();
            else if (build.success) createFromDescription.mutate(build.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              {kind === "designed"
                ? "Design a document from scratch: content, header and footer, and the fields it needs."
                : kind === "overlay"
                  ? "Upload a PDF you already use, then place boxes where the answers go."
                  : "Describe the document. It opens in the editor with the AI assistant proposing fields and content for you to review."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="template-kind">Kind</FieldLabel>
              <NativeSelect
                id="template-kind"
                value={kind}
                onChange={(e) => isKind(e.target.value) && setKind(e.target.value)}
              >
                <NativeSelectOption value="designed">Design from scratch</NativeSelectOption>
                <NativeSelectOption value="overlay">Fill an existing PDF</NativeSelectOption>
                {aiEnabled && (
                  <NativeSelectOption value="ai">
                    Describe it to the AI assistant
                  </NativeSelectOption>
                )}
              </NativeSelect>
            </Field>
            {kind === "ai" && (
              <Field>
                <FieldLabel htmlFor="template-prompt">Describe the document</FieldLabel>
                <Textarea
                  id="template-prompt"
                  rows={5}
                  autoFocus
                  value={prompt}
                  placeholder="A surety bond for a contractor licence in Oregon: principal, surety and obligee, penal sum, effective date."
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <FieldDescription>
                  Sent to Anthropic (Claude). Nothing is added until you apply it.
                </FieldDescription>
              </Field>
            )}
            {kind === "overlay" && (
              <Field>
                <FieldLabel htmlFor="template-pdf">PDF (up to 20 MB)</FieldLabel>
                <Input
                  id="template-pdf"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null;
                    setFile(picked);
                    if (picked && !form.getFieldValue("name")) {
                      form.setFieldValue("name", picked.name.replace(/\.pdf$/i, ""));
                    }
                  }}
                />
              </Field>
            )}
            {kind !== "ai" && (
              <>
                <form.AppField name="name">
                  {(field) => (
                    <field.TextField label="Name" autoFocus placeholder="Surety bond certificate" />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {(field) => <field.TextareaField label="Description (optional)" rows={3} />}
                </form.AppField>
              </>
            )}
          </FieldGroup>
          <ErrorAlert error={create.error ?? createFromDescription.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={
                create.isPending ||
                createFromDescription.isPending ||
                (kind === "overlay" && !file) ||
                (kind === "ai" && !build.success)
              }
            >
              {create.isPending && kind === "overlay" ? "Uploading…" : "Create and open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
