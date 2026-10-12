import { createTemplateSchema, hasPermission, type TemplateSummary } from "@necodoc/shared";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CopyIcon,
  DotsThreeIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PencilRulerIcon,
  PencilSimpleIcon,
  type Icon as PhosphorIcon,
  PlusIcon,
  SparkleIcon,
  StackIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useAiEnabled } from "@/components/ai";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DebouncedInput, DensityToggle } from "@/components/data-table";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { templatesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { uploadPdfSource } from "./-overlay-editor";
import {
  DeleteTemplateDialog,
  type TemplateStatus,
  TemplateStatusBadges,
  templateStatus,
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

/** The status filter's segments, in order. "All" leaves archived templates out. */
const segments = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "changes", label: "Unpublished changes" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
] as const satisfies readonly { value: TemplateStatus | "all"; label: string }[];

const kindLabels = {
  designed: { label: "Designed", icon: PencilRulerIcon },
  overlay: { label: "PDF overlay", icon: StackIcon },
} as const satisfies Record<TemplateSummary["kind"], { label: string; icon: PhosphorIcon }>;

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
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const words = (search.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  const matching = (templates.data ?? []).filter((t) => {
    const text = `${t.name} ${t.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const counts: Record<TemplateStatus, number> = {
    draft: 0,
    published: 0,
    changes: 0,
    archived: 0,
  };
  for (const t of matching) counts[templateStatus(t)]++;
  const segmentCount = (value: TemplateStatus | "all") =>
    value === "all" ? matching.length - counts.archived : counts[value];
  // Archived templates only show when asked for.
  const rows = matching.filter((t) => {
    const status = templateStatus(t);
    return search.status ? status === search.status : status !== "archived";
  });
  const filtered = words.length > 0 || search.status !== undefined;

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
              <>
                <Button variant="outline" onClick={() => setCreating("overlay")}>
                  <UploadSimpleIcon />
                  Upload PDF
                </Button>
                <Button onClick={() => setCreating("designed")}>
                  <PlusIcon weight="bold" />
                  New template
                </Button>
              </>
            )}
          </>
        }
      />

      <ErrorAlert error={templates.error ?? duplicate.error ?? archive.error} />

      {templates.isSuccess && templates.data.length === 0 ? (
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
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3.5">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
              />
              <DebouncedInput
                type="search"
                aria-label="Search templates"
                className="pl-9"
                placeholder="Search name or description"
                value={search.q ?? ""}
                onCommit={(q) =>
                  navigate({ search: { ...search, q: q || undefined }, replace: true })
                }
              />
            </div>
            {seesDrafts && (
              <Tabs
                className="order-last xl:order-none"
                value={search.status ?? "all"}
                onValueChange={(value) =>
                  navigate({ search: { ...search, status: statusSchema.safeParse(value).data } })
                }
              >
                <TabsList aria-label="Status" className="h-auto flex-wrap justify-start">
                  {segments.map((segment) => (
                    <TabsTrigger
                      key={segment.value}
                      value={segment.value}
                      className="h-8 flex-none"
                    >
                      {segment.label}
                      <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                        {templates.isSuccess ? segmentCount(segment.value) : ""}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <div className="ml-auto flex items-center gap-3">
              {templates.isSuccess && (
                <span className="text-[13px] text-ink-3" aria-live="polite">
                  {rows.length} {rows.length === 1 ? "template" : "templates"}
                </span>
              )}
              <DensityToggle />
            </div>
          </div>

          {templates.isPending ? (
            <ListSkeleton className="p-4" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4 lg:w-2/5">Name</TableHead>
                  <TableHead className="hidden lg:table-cell">Kind</TableHead>
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
                {rows.map((t) => {
                  const kind = kindLabels[t.kind];
                  const when = seesDrafts ? t.updatedAt : (t.publishedAt ?? t.updatedAt);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-60 min-w-40 pl-4 whitespace-normal lg:max-w-md">
                        {seesDrafts ? (
                          <Link
                            to="/templates/$id"
                            params={{ id: t.id }}
                            className="font-semibold hover:text-brand-ink hover:underline"
                          >
                            {t.name}
                          </Link>
                        ) : (
                          <span className="font-semibold">{t.name}</span>
                        )}
                        {t.description && (
                          <p className="truncate text-[12.5px] text-ink-3" title={t.description}>
                            {t.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-ink-2 lg:table-cell">
                        <span className="inline-flex items-center gap-1.5">
                          <kind.icon aria-hidden className="size-4 text-brand-ink" />
                          {kind.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {/* Draft state is editors' business; viewers see the published version. */}
                        <TemplateStatusBadges
                          template={seesDrafts ? t : { ...t, hasUnpublishedChanges: false }}
                        />
                      </TableCell>
                      <TableCell className="hidden text-ink-3 sm:table-cell">
                        <time dateTime={when} title={dayjs(when).format("MMM D, YYYY h:mm A")}>
                          {dayjs(when).fromNow()}
                        </time>
                      </TableCell>
                      <TableCell className="pr-4">
                        {/* Anyone who can see a published template can fill it in. */}
                        {!seesDrafts && (
                          <Button
                            variant="secondary"
                            size="sm"
                            nativeButton={false}
                            aria-label={`Fill in ${t.name}`}
                            render={<Link to="/documents/new" search={{ template: t.id }} />}
                          >
                            Fill in
                          </Button>
                        )}
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
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                render={<Link to="/templates/$id" params={{ id: t.id }} />}
                              >
                                <PencilSimpleIcon />
                                {can("edit") ? "Edit" : "Open"}
                              </DropdownMenuItem>
                              {t.latestVersion !== null && !t.archivedAt && (
                                <DropdownMenuItem
                                  render={<Link to="/documents/new" search={{ template: t.id }} />}
                                >
                                  <NotePencilIcon />
                                  Fill in
                                </DropdownMenuItem>
                              )}
                              {can("create") && (
                                <DropdownMenuItem
                                  disabled={duplicate.isPending}
                                  onClick={() => duplicate.mutate(t.id)}
                                >
                                  <CopyIcon />
                                  Duplicate
                                </DropdownMenuItem>
                              )}
                              {can("publish") &&
                                (t.archivedAt ? (
                                  <DropdownMenuItem
                                    onClick={() => archive.mutate({ id: t.id, archive: false })}
                                  >
                                    <ArrowCounterClockwiseIcon />
                                    Restore
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => setArchiving(t)}>
                                    <ArchiveIcon />
                                    Archive…
                                  </DropdownMenuItem>
                                ))}
                              {can("edit") && t.latestVersion === null && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setDeleting(t)}
                                  >
                                    <TrashIcon />
                                    Delete…
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="h-24 text-center whitespace-normal text-ink-3"
                    >
                      {search.status === "archived" && words.length === 0
                        ? "Nothing is archived."
                        : "No templates match."}
                      {filtered && (
                        <Button
                          variant="link"
                          className="ml-1 h-auto p-0"
                          onClick={() =>
                            navigate({
                              search: { ...search, q: undefined, status: undefined },
                              replace: true,
                            })
                          }
                        >
                          Clear filters
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>
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
      {archiving && (
        <ConfirmDialog
          title={`Archive ${archiving.name}?`}
          description="It leaves the fill list and the API. Its versions and the documents made from it stay. Restore it any time from the Archived filter."
          confirmLabel="Archive template"
          destructive={false}
          pending={archive.isPending}
          error={archive.error}
          onConfirm={() =>
            archive.mutate(
              { id: archiving.id, archive: true },
              { onSuccess: () => setArchiving(null) },
            )
          }
          onClose={() => setArchiving(null)}
        />
      )}
    </Page>
  );
}

const createSchema = z.object({
  name: createTemplateSchema.options[0].shape.name,
  description: z.string().max(2000),
});

type Kind = "designed" | "overlay" | "ai";

const kindOptions = [
  {
    value: "designed",
    label: "Design from scratch",
    hint: "Lay out the content, header and footer, and the fields it needs.",
    icon: PencilRulerIcon,
  },
  {
    value: "overlay",
    label: "Fill an existing PDF",
    hint: "Upload a PDF you already use, then place boxes where the answers go.",
    icon: StackIcon,
  },
  {
    value: "ai",
    label: "Describe it to the AI assistant",
    hint: "It opens in the editor with proposed fields and content for you to review.",
    icon: SparkleIcon,
  },
] as const satisfies readonly { value: Kind; label: string; hint: string; icon: PhosphorIcon }[];

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
  const pending = create.isPending || createFromDescription.isPending;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (kind !== "ai") form.handleSubmit();
            else if (build.success) createFromDescription.mutate(build.data);
          }}
        >
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              Pick how to start. The template opens in the editor.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Start from</legend>
            {kindOptions
              .filter((option) => option.value !== "ai" || aiEnabled)
              .map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg bg-tint p-3 transition-colors hover:bg-tint-2",
                    "has-checked:bg-brand-wash has-checked:shadow-[inset_0_0_0_2px_var(--brand)]",
                    "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                  )}
                >
                  <input
                    type="radio"
                    name="template-kind"
                    value={option.value}
                    checked={kind === option.value}
                    onChange={() => setKind(option.value)}
                    className="sr-only"
                  />
                  <option.icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-ink" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="block text-[13px] text-ink-3">{option.hint}</span>
                  </span>
                </label>
              ))}
          </fieldset>
          <FieldGroup>
            {kind === "ai" && (
              <Field>
                <FieldLabel htmlFor="template-prompt">Describe the document</FieldLabel>
                <Textarea
                  id="template-prompt"
                  rows={5}
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
                <FieldLabel htmlFor="template-pdf">PDF to fill (up to 20 MB)</FieldLabel>
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
                    <field.TextField label="Name" placeholder="Surety bond certificate" />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {(field) => <field.TextareaField label="Description (optional)" rows={2} />}
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
                pending || (kind === "overlay" && !file) || (kind === "ai" && !build.success)
              }
            >
              {pending ? (kind === "overlay" ? "Uploading…" : "Creating…") : "Create and open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
