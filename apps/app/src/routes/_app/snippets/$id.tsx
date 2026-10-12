import {
  compileDoc,
  docSchema,
  type FieldSection,
  fieldKeySchema,
  hasPermission,
  TemplateCompileError,
  updateSnippetSchema,
} from "@necodoc/shared";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  DotsThreeIcon,
  EyeIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HistoryPanel } from "@/components/audit";
import { CodeEditor } from "@/components/code-editor";
import { DocEditor } from "@/components/editor/doc-editor";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { requireAccess } from "@/lib/auth";
import { usePageCrumb } from "@/lib/breadcrumb";
import { dayjs } from "@/lib/date";
import { snippetsQuery } from "@/lib/queries";
import { useSaveShortcut } from "@/lib/save-shortcut";
import { cn } from "@/lib/utils";

// Spec: docs/features/snippet-library.md. Editors change the snippet; everyone who opens drafts
// sees it read-only, with the templates that use it and which published versions are behind.

/** The snippet with the templates and snippets that use it. */
const fetchSnippet = async (id: string) =>
  (await ok(api.snippets[":id"].$get({ param: { id } }))).json();
type SnippetDetail = Awaited<ReturnType<typeof fetchSnippet>>;

const snippetQuery = (id: string) =>
  queryOptions({ queryKey: ["snippets", id], queryFn: () => fetchSnippet(id) });

export const Route = createFileRoute("/_app/snippets/$id")({
  beforeLoad: ({ context }) => requireAccess(context.me, ["create", "edit", "review", "publish"]),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(snippetQuery(params.id)),
  component: SnippetPage,
});

function SnippetPage() {
  const { id } = Route.useParams();
  const snippet = useSuspenseQuery(snippetQuery(id)).data;
  usePageCrumb(snippet.name);
  return <SnippetEditor key={snippet.id} snippet={snippet} />;
}

type EditorContent = { mode: "visual"; doc: JSONContent } | { mode: "code"; html: string };

/** What the editor holds: tags and fields as typed, the doc as TipTap hands it back. */
type Values = {
  name: string;
  description: string;
  tags: string;
  fields: string;
  content: EditorContent;
};

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toValues = (s: SnippetDetail): Values => ({
  name: s.name,
  description: s.description,
  tags: s.tags.join(", "),
  fields: s.fields.join(", "),
  content: s.content,
});

/** The expected fields as text fields, so the editor's pickers offer them. */
const fieldSections = (keys: readonly string[]): FieldSection[] => [
  {
    title: "Snippet fields",
    fields: keys.map((key) => ({ type: "text", key, label: key, required: false })),
  },
];

function SnippetEditor({ snippet }: { snippet: SnippetDetail }) {
  const { me } = Route.useRouteContext();
  const canEdit = hasPermission(me.user.roles, { document: ["edit"] });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState(() => toValues(snippet));
  const [saved, setSaved] = useState(() => JSON.stringify(toValues(snippet)));
  const [dialog, setDialog] = useState<"code" | "delete" | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const change = (changes: Partial<Values>) => setValues((v) => ({ ...v, ...changes }));
  const dirty = canEdit && JSON.stringify(values) !== saved;

  const fieldKeys = list(values.fields);
  const badKeys = fieldKeys.filter((key) => !fieldKeySchema.safeParse(key).success);
  const sections = useMemo(
    () => fieldSections(list(values.fields).filter((key) => fieldKeySchema.safeParse(key).success)),
    [values.fields],
  );
  const parsed = updateSnippetSchema.safeParse({
    name: values.name,
    description: values.description,
    tags: list(values.tags),
    fields: fieldKeys,
    content: values.content,
  });

  const store = (row: SnippetDetail) => {
    queryClient.setQueryData(snippetQuery(row.id).queryKey, row);
    return queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey, exact: true });
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.success) throw new Error("Fix the problems listed above first.");
      const sent = JSON.stringify(values);
      const row = await (
        await ok(api.snippets[":id"].$patch({ param: { id: snippet.id }, json: parsed.data }))
      ).json();
      return { row, sent };
    },
    onSuccess: async ({ row, sent }) => {
      setSaved(sent);
      await store(row);
    },
  });
  const archive = useMutation({
    mutationFn: async (archived: boolean) =>
      (
        await ok(api.snippets[":id"].$patch({ param: { id: snippet.id }, json: { archived } }))
      ).json(),
    onSuccess: async (row) => {
      toast.success(row.archivedAt ? `Archived ${row.name}` : `Restored ${row.name}`);
      await store(row);
    },
  });
  const remove = useMutation({
    mutationFn: async () => ok(api.snippets[":id"].$delete({ param: { id: snippet.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: snippetQuery(snippet.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey, exact: true });
      setSaved(JSON.stringify(values));
      await navigate({ to: "/snippets" });
      toast.success(`Deleted ${snippet.name}`);
    },
  });
  useSaveShortcut(dirty && !save.isPending && parsed.success, save.mutate);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !remove.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const convertToCode = () => {
    if (values.content.mode !== "visual") return;
    const doc = docSchema.safeParse(values.content.doc);
    if (!doc.success) return setCodeError("Fix the content problems first.");
    try {
      change({ content: { mode: "code", html: compileDoc(doc.data, sections, "\n") } });
      setDialog(null);
    } catch (error) {
      if (!(error instanceof TemplateCompileError)) throw error;
      setCodeError(error.message);
    }
  };

  const outOfDate = snippet.usedBy.filter((u) => u.outOfDate);
  const usedInDrafts = snippet.usedBy.filter((u) => u.inDraft);
  const { content } = values;

  return (
    <Page width="wide" className="space-y-4 pb-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 shrink-0"
          aria-label="Back to snippets"
          title="Snippets"
          nativeButton={false}
          render={<Link to="/snippets" />}
        >
          <ArrowLeftIcon weight="bold" />
        </Button>
        <div className="min-w-[min(100%,20rem)] flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Input
              aria-label="Snippet name"
              className="h-11 w-auto max-w-full min-w-48 border-transparent bg-transparent px-2 font-heading text-[26px] font-bold tracking-[-0.02em] field-sizing-content hover:border-input focus:bg-surface md:text-[26px]"
              value={values.name}
              readOnly={!canEdit}
              onChange={(e) => change({ name: e.target.value })}
            />
            {snippet.archivedAt && (
              <Badge variant="secondary" dot>
                Archived
              </Badge>
            )}
            {content.mode === "code" && <Badge variant="secondary">Code mode</Badge>}
            {canEdit && (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-ink-3"
              >
                {dirty ? (
                  <CloudArrowUpIcon className="size-4" />
                ) : (
                  <CloudCheckIcon className="size-4" />
                )}
                {save.isPending
                  ? "Saving…"
                  : dirty
                    ? "Unsaved changes"
                    : `Saved ${dayjs(snippet.updatedAt).fromNow()}`}
              </span>
            )}
          </div>
          <p className="px-2 text-[13px] text-ink-3">
            Include it in code templates with{" "}
            <code className="font-mono text-ink-2">{`{% render '${snippet.key}' %}`}</code>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <FaqLink feature="Snippet library" className="mr-1" />
          {canEdit && (
            <>
              <Button
                variant={dirty ? "default" : "outline"}
                disabled={!dirty || save.isPending || !parsed.success}
                title={parsed.success ? "Save (⌘S)" : "Fix the problems first"}
                onClick={() => save.mutate()}
              >
                Save
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label="More actions" />}
                >
                  <DotsThreeIcon weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(!snippet.archivedAt)}
                  >
                    {snippet.archivedAt ? "Restore" : "Archive"}
                  </DropdownMenuItem>
                  {content.mode === "visual" && (
                    <DropdownMenuItem onClick={() => setDialog("code")}>
                      Code mode…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                    Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <Alert>
          <EyeIcon />
          <AlertDescription>You can see this snippet, but not change it.</AlertDescription>
        </Alert>
      )}
      {snippet.archivedAt && (
        <Alert>
          <ArchiveIcon />
          <AlertDescription>
            Archived {dayjs(snippet.archivedAt).fromNow()}: hidden from the editor's Insert menu.
            Templates that already use it keep working.
          </AlertDescription>
        </Alert>
      )}
      {outOfDate.length > 0 && (
        <Alert>
          <WarningIcon className="text-warn" />
          <AlertTitle>Published versions out of date</AlertTitle>
          <AlertDescription>
            {outOfDate.length === 1 ? "One template's" : `${outOfDate.length} templates'`} latest
            published version uses an older copy of this snippet. Their drafts already show the
            current one; republish them to put it live.
          </AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={save.error ?? archive.error ?? remove.error} />
      {canEdit && !parsed.success && (
        <Alert variant="destructive">
          <AlertTitle>Can't save yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {parsed.error.issues.slice(0, 6).map((issue) => (
                <li key={`${issue.path.join(".")}:${issue.message}`}>
                  {issue.path.join(".") || "Snippet"}: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {content.mode === "code" ? (
          <Card className="self-start">
            <CardContent>
              <Field>
                <FieldLabel>HTML (Liquid)</FieldLabel>
                <CodeEditor
                  label="Snippet HTML (Liquid)"
                  language="liquid"
                  sections={sections}
                  readOnly={!canEdit}
                  value={content.html}
                  onChange={(html) => change({ content: { mode: "code", html } })}
                  className="[&_.cm-editor]:min-h-[50svh]"
                />
                <FieldDescription>
                  Sees the document's top-level fields:{" "}
                  <code className="font-mono">{"{{ principal_name }}"}</code>. Other snippets:{" "}
                  <code className="font-mono">{"{% render 'key' %}"}</code>.
                </FieldDescription>
              </Field>
            </CardContent>
          </Card>
        ) : (
          <DocEditor
            value={content.doc}
            onChange={(doc) => change({ content: { mode: "visual", doc } })}
            sections={sections}
            editable={canEdit}
            snippetId={snippet.id}
            className="self-start [&_.tiptap]:min-h-[50svh]"
          />
        )}

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="snippet-description">Description</FieldLabel>
                  <Textarea
                    id="snippet-description"
                    rows={2}
                    placeholder="What it's for, so others pick the right one"
                    readOnly={!canEdit}
                    value={values.description}
                    onChange={(e) => change({ description: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="snippet-tags">Tags</FieldLabel>
                  <Input
                    id="snippet-tags"
                    placeholder="legal, surety"
                    readOnly={!canEdit}
                    value={values.tags}
                    onChange={(e) => change({ tags: e.target.value })}
                  />
                  <FieldDescription>Comma-separated.</FieldDescription>
                </Field>
                <Field data-invalid={badKeys.length > 0}>
                  <FieldLabel htmlFor="snippet-fields">Expected fields</FieldLabel>
                  <Input
                    id="snippet-fields"
                    placeholder="principal_name, bond_amount"
                    readOnly={!canEdit}
                    aria-invalid={badKeys.length > 0 || undefined}
                    aria-describedby="snippet-fields-hint"
                    className="font-mono text-[13px] md:text-[13px]"
                    value={values.fields}
                    onChange={(e) => change({ fields: e.target.value })}
                  />
                  <FieldDescription id="snippet-fields-hint">
                    {badKeys.length
                      ? `Not field keys: ${badKeys.join(", ")}`
                      : "Comma-separated field keys. The editor's Field picker offers these, and templates missing one get a warning."}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Used by</CardTitle>
              <CardDescription>
                Drafts use the current snippet; each published version keeps the copy it was
                published with.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {snippet.usedBy.length === 0 && snippet.includedIn.length === 0 && (
                <p className="text-ink-3">
                  No template uses it yet. Add it from a template editor's Insert menu.
                </p>
              )}
              {snippet.usedBy.length > 0 && (
                <ul className="divide-y divide-hair">
                  {snippet.usedBy.map((u) => (
                    <li key={u.templateId} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
                      <Link
                        to="/templates/$id"
                        params={{ id: u.templateId }}
                        className="block truncate font-semibold hover:underline"
                      >
                        {u.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {u.inDraft && <Badge variant="secondary">In draft</Badge>}
                        {u.inLatestVersion &&
                          (u.outOfDate ? (
                            <Badge variant="warn" dot>
                              v{u.latestVersion} out of date
                            </Badge>
                          ) : (
                            <Badge variant="ok" dot>
                              v{u.latestVersion} up to date
                            </Badge>
                          ))}
                        {!u.inLatestVersion && u.latestVersion !== null && (
                          <Badge variant="secondary">Not in v{u.latestVersion}</Badge>
                        )}
                        {u.outOfDate && (
                          <Link
                            to="/templates/$id"
                            params={{ id: u.templateId }}
                            className="text-xs font-semibold text-brand-ink hover:underline"
                          >
                            Open to republish
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {snippet.includedIn.length > 0 && (
                <div
                  className={cn(
                    "space-y-1.5",
                    snippet.usedBy.length > 0 && "mt-3 border-t border-hair pt-3",
                  )}
                >
                  <p className="text-xs font-semibold text-ink-3">Included in snippets</p>
                  {snippet.includedIn.map((s) => (
                    <Link
                      key={s.id}
                      to="/snippets/$id"
                      params={{ id: s.id }}
                      className="block truncate font-semibold hover:underline"
                    >
                      {s.name}
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === "code" && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch to code mode?</AlertDialogTitle>
              <AlertDialogDescription>
                The content is compiled to HTML and Liquid you edit by hand. It's one way: once
                saved, the snippet can't go back to the visual editor.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {codeError && (
              <Alert variant="destructive">
                <AlertDescription>{codeError}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={convertToCode}>
                Convert
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {dialog === "delete" && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {snippet.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {usedInDrafts.length || snippet.includedIn.length
                  ? "It's still used, so it can't be deleted; archive it to hide it from the pickers instead."
                  : "Published versions keep their own copy. This can't be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={remove.isPending || usedInDrafts.length + snippet.includedIn.length > 0}
                onClick={() => remove.mutate()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {blocker.status === "blocked" && (
        <AlertDialog open onOpenChange={(open) => !open && blocker.reset()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
              <AlertDialogDescription>Your unsaved changes are lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => blocker.reset()}>Stay</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => blocker.proceed()}>
                Leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <HistoryPanel targetType="snippet" targetId={snippet.id} />
    </Page>
  );
}
