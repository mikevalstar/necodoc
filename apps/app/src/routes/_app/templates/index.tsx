import {
  createTemplateSchema,
  type DesignedFormat,
  emptyDesignedContentFor,
  hasPermission,
  type TemplateSummary,
} from "@necodoc/shared";
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
  RowsIcon,
  SparkleIcon,
  SquaresFourIcon,
  StackIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import { useAiEnabled } from "@/components/ai";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DebouncedInput, DensityToggle } from "@/components/data-table";
import { ErrorAlert, useAppForm } from "@/components/form";
import { EmptyState, FaqLink, ListSkeleton, Page, PageHeader } from "@/components/page";
import { TemplateThumbnail } from "@/components/template-thumbnail";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Table or gallery, remembered per browser. */
const viewSchema = z.enum(["gallery", "list"]);
type View = z.infer<typeof viewSchema>;
const viewKey = "necodoc-templates-view";

function storedView(): View {
  try {
    return viewSchema.catch("gallery").parse(localStorage.getItem(viewKey));
  } catch {
    return "gallery"; // storage blocked
  }
}

type Action = "create" | "edit" | "review" | "publish";

const kindLabels = {
  designed: { label: "Designed", icon: PencilRulerIcon },
  overlay: { label: "PDF overlay", icon: StackIcon },
} as const satisfies Record<TemplateSummary["kind"], { label: string; icon: PhosphorIcon }>;

function Templates() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { me } = Route.useRouteContext();
  const can = (action: Action) => hasPermission(me.user.roles, { document: [action] });
  const seesDrafts = can("edit") || can("review") || can("publish");
  const templates = useQuery(templatesQuery);
  const duplicate = useDuplicateTemplate();
  const archive = useArchiveTemplate();
  // ?new= opens the dialog (first-run links, the command palette), also on this page already.
  const [picked, setCreating] = useState<Kind | null>(null);
  const creating = picked ?? (can("create") ? (search.new ?? null) : null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState(storedView);
  const pickView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {
      // storage blocked: the choice lasts until reload
    }
  };
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
  const actions = (t: TemplateSummary, onCard = false) => (
    <TemplateActions
      onCard={onCard}
      template={t}
      seesDrafts={seesDrafts}
      can={can}
      duplicate={duplicate}
      archive={archive}
      onArchive={() => setArchiving(t)}
      onDelete={() => setDeleting(t)}
    />
  );
  const noMatch = (
    <>
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
    </>
  );

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
        <>
          <Card className="gap-0 py-0">
            <div
              className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-3.5",
                view === "list" && "border-b border-hair",
              )}
            >
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
                {view === "list" && <DensityToggle />}
                <fieldset aria-label="View" className="flex gap-0.5 rounded-[10px] bg-tint p-0.5">
                  {(
                    [
                      ["gallery", "Gallery", SquaresFourIcon],
                      ["list", "Table", RowsIcon],
                    ] as const
                  ).map(([value, label, ViewIcon]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={view === value}
                      aria-label={label}
                      title={label}
                      onClick={() => pickView(value)}
                      className={cn(
                        "grid h-7 w-8 place-items-center rounded-[7px] text-ink-2 hover:text-ink [&>svg]:size-4",
                        view === value && "bg-surface text-ink shadow-card",
                      )}
                    >
                      <ViewIcon />
                    </button>
                  ))}
                </fieldset>
              </div>
            </div>

            {view === "gallery" ? null : templates.isPending ? (
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
                        <TableCell className="pr-4">{actions(t)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center whitespace-normal text-ink-3"
                      >
                        {noMatch}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
          {view === "gallery" && (
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5"
              aria-busy={templates.isPending}
            >
              {templates.isPending &&
                [0, 1, 2, 3].map((i) => (
                  <li key={i}>
                    <Skeleton className="h-64 rounded-xl" />
                  </li>
                ))}
              {rows.map((t) => (
                <li key={t.id}>
                  <GalleryCard
                    template={t}
                    seesDrafts={seesDrafts}
                    menu={seesDrafts && actions(t, true)}
                  />
                </li>
              ))}
              {templates.isSuccess && rows.length === 0 && (
                <li className="col-span-full py-8 text-center text-ink-3">{noMatch}</li>
              )}
              {can("create") && !filtered && templates.isSuccess && (
                <li>
                  <button
                    type="button"
                    onClick={() => setCreating("designed")}
                    className="grid h-full min-h-64 w-full place-items-center rounded-xl border-2 border-dashed border-tint-2 p-6 text-center text-[13px] text-ink-3 transition-colors hover:border-brand hover:text-ink-2"
                  >
                    <span>
                      <span className="mx-auto mb-2.5 grid size-13 place-items-center rounded-2xl bg-brand-wash text-brand">
                        <PlusIcon aria-hidden weight="bold" className="size-6" />
                      </span>
                      <span className="block font-heading text-[15.5px] font-bold text-ink">
                        Start a template
                      </span>
                      Design one, or upload a PDF
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
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

/**
 * A row's actions. Viewers fill in; draft users get the menu (`onCard`: on a gallery thumbnail).
 */
function TemplateActions({
  template: t,
  seesDrafts,
  can,
  duplicate,
  archive,
  onArchive,
  onDelete,
  onCard = false,
}: {
  template: TemplateSummary;
  seesDrafts: boolean;
  can: (action: Action) => boolean;
  duplicate: ReturnType<typeof useDuplicateTemplate>;
  archive: ReturnType<typeof useArchiveTemplate>;
  onArchive: () => void;
  onDelete: () => void;
  onCard?: boolean;
}) {
  // Anyone who can see a published template can fill it in.
  if (!seesDrafts) {
    return (
      <Button
        variant="secondary"
        size="sm"
        nativeButton={false}
        aria-label={`Fill in ${t.name}`}
        render={<Link to="/documents/new" search={{ template: t.id }} />}
      >
        Fill in
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${t.name}`}
            className={cn(onCard && "bg-surface shadow-card hover:bg-surface")}
          />
        }
      >
        <DotsThreeIcon weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem render={<Link to="/templates/$id" params={{ id: t.id }} />}>
          <PencilSimpleIcon />
          {can("edit") ? "Edit" : "Open"}
        </DropdownMenuItem>
        {t.latestVersion !== null && !t.archivedAt && (
          <DropdownMenuItem render={<Link to="/documents/new" search={{ template: t.id }} />}>
            <NotePencilIcon />
            Fill in
          </DropdownMenuItem>
        )}
        {can("create") && (
          <DropdownMenuItem disabled={duplicate.isPending} onClick={() => duplicate.mutate(t.id)}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
        )}
        {can("publish") &&
          (t.archivedAt ? (
            <DropdownMenuItem onClick={() => archive.mutate({ id: t.id, archive: false })}>
              <ArrowCounterClockwiseIcon />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onArchive}>
              <ArchiveIcon />
              Archive…
            </DropdownMenuItem>
          ))}
        {can("edit") && t.latestVersion === null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <TrashIcon />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A template as a card with its page-1 thumbnail. The name link (the editor, or Fill in for
 * viewers) stretches over the card, so the card is one click target; the menu sits above it.
 */
function GalleryCard({
  template: t,
  seesDrafts,
  menu,
}: {
  template: TemplateSummary;
  seesDrafts: boolean;
  menu: ReactNode;
}) {
  const kind = kindLabels[t.kind];
  const when = seesDrafts ? t.updatedAt : (t.publishedAt ?? t.updatedAt);
  return (
    <Card className="relative h-full gap-0 overflow-hidden py-0 transition-shadow hover:shadow-float">
      <TemplateThumbnail template={t} />
      <div className="flex flex-1 flex-col gap-1.5 px-4 pt-3.5 pb-4">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-brand-ink uppercase">
          <kind.icon aria-hidden className="size-3.5" />
          {kind.label}
        </span>
        {seesDrafts ? (
          <Link
            to="/templates/$id"
            params={{ id: t.id }}
            className="font-heading text-[15.5px] leading-tight font-bold tracking-tight after:absolute after:inset-0 hover:text-brand-ink"
          >
            {t.name}
          </Link>
        ) : (
          <Link
            to="/documents/new"
            search={{ template: t.id }}
            title={`Fill in ${t.name}`}
            className="font-heading text-[15.5px] leading-tight font-bold tracking-tight after:absolute after:inset-0 hover:text-brand-ink"
          >
            {t.name}
          </Link>
        )}
        {t.description && (
          <p className="truncate text-[12.5px] text-ink-3" title={t.description}>
            {t.description}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1.5">
          <TemplateStatusBadges
            template={seesDrafts ? t : { ...t, hasUnpublishedChanges: false }}
          />
          <time
            dateTime={when}
            title={dayjs(when).format("MMM D, YYYY h:mm A")}
            className="ml-auto text-[12.5px] text-ink-3"
          >
            {dayjs(when).fromNow()}
          </time>
        </div>
      </div>
      {menu && <div className="absolute top-2.5 right-2.5 z-10">{menu}</div>}
    </Card>
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

/** How a designed template is written. The first is the default; add a content mode, add it here. */
const formatOptions = [
  {
    value: "visual",
    label: "Visual editor",
    hint: "Write and lay out the document like a word processor.",
  },
  {
    value: "code",
    label: "Liquid (HTML code)",
    hint: "Write HTML and Liquid by hand in a code editor. It can't switch to the visual editor later.",
  },
] as const satisfies readonly { value: DesignedFormat; label: string; hint: string }[];

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
  const [format, setFormat] = useState<DesignedFormat>(formatOptions[0].value);
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
        const content = emptyDesignedContentFor(format);
        return (
          await ok(api.templates.$post({ json: { kind: "designed", ...json, content } }))
        ).json();
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
            {kind === "designed" && (
              <Field>
                <FieldLabel htmlFor="template-format">Format</FieldLabel>
                <NativeSelect
                  id="template-format"
                  className="w-full"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as DesignedFormat)}
                >
                  {formatOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  {formatOptions.find((option) => option.value === format)?.hint}
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
