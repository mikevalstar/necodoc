import {
  compileDoc,
  docSchema,
  type FieldSection,
  fieldKeySchema,
  hasPermission,
  TemplateCompileError,
  updateSnippetSchema,
} from "@necodoc/shared";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useBlocker, useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { ChevronLeftIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { HistoryPanel } from "@/components/audit";
import { CodeEditor } from "@/components/code-editor";
import { DocEditor } from "@/components/editor/doc-editor";
import { ErrorAlert } from "@/components/form";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";
import { snippetsQuery } from "@/lib/queries";

// Spec: docs/features/snippet-library.md. Editors change the snippet; everyone who opens drafts
// sees it read-only, with the templates that use it and which published versions are behind.

/** The snippet with the templates and snippets that use it. */
const fetchSnippet = async (id: string) =>
  (await ok(api.snippets[":id"].$get({ param: { id } }))).json();
type SnippetDetail = Awaited<ReturnType<typeof fetchSnippet>>;

const snippetQuery = (id: string) =>
  queryOptions({ queryKey: ["snippets", id], queryFn: () => fetchSnippet(id) });

export const Route = createFileRoute("/_app/snippets/$id")({
  beforeLoad: ({ context }) => {
    const roles = context.me.user.roles;
    const sees = (["create", "edit", "review", "publish"] as const).some((action) =>
      hasPermission(roles, { document: [action] }),
    );
    if (!sees) throw redirect({ to: "/" });
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(snippetQuery(params.id)),
  component: SnippetPage,
});

function SnippetPage() {
  const { id } = Route.useParams();
  const snippet = useSuspenseQuery(snippetQuery(id)).data;
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
    onSuccess: store,
  });
  const remove = useMutation({
    mutationFn: async () => ok(api.snippets[":id"].$delete({ param: { id: snippet.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: snippetQuery(snippet.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: snippetsQuery.queryKey, exact: true });
      setSaved(JSON.stringify(values));
      await navigate({ to: "/snippets" });
    },
  });

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
    <main className="mx-auto max-w-6xl space-y-4 p-4 py-6">
      <Link
        to="/snippets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Snippets
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Snippet name"
          className="h-10 max-w-xl flex-1 border-transparent px-1 text-2xl font-semibold shadow-none hover:border-input md:text-2xl"
          value={values.name}
          readOnly={!canEdit}
          onChange={(e) => change({ name: e.target.value })}
        />
        <code className="text-sm text-muted-foreground">{`{% render '${snippet.key}' %}`}</code>
        {content.mode === "code" && <Badge variant="secondary">Code mode</Badge>}
        {snippet.archivedAt && <Badge variant="secondary">Archived</Badge>}
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <span role="status" className="text-sm text-muted-foreground">
              {save.isPending
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : `Saved ${dayjs(snippet.updatedAt).fromNow()}`}
            </span>
            <Button
              disabled={!dirty || save.isPending || !parsed.success}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            {content.mode === "visual" && (
              <Button variant="outline" onClick={() => setDialog("code")}>
                Code mode…
              </Button>
            )}
            <Button
              variant="outline"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!snippet.archivedAt)}
            >
              {snippet.archivedAt ? "Restore" : "Archive"}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setDialog("delete")}
            >
              Delete…
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <Alert>
          <AlertDescription>You can see this snippet, but not change it.</AlertDescription>
        </Alert>
      )}
      {outOfDate.length > 0 && (
        <Alert>
          <TriangleAlertIcon />
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="snippet-description">Description</FieldLabel>
              <Textarea
                id="snippet-description"
                rows={2}
                readOnly={!canEdit}
                value={values.description}
                onChange={(e) => change({ description: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
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
                  value={values.fields}
                  onChange={(e) => change({ fields: e.target.value })}
                />
                <FieldDescription>
                  {badKeys.length
                    ? `Not field keys: ${badKeys.join(", ")}`
                    : "Comma-separated field keys. The editor offers these; templates without one get it flagged."}
                </FieldDescription>
              </Field>
            </div>
          </FieldGroup>
          {content.mode === "code" ? (
            <Field>
              <FieldLabel>HTML (Liquid)</FieldLabel>
              <CodeEditor
                label="Snippet HTML (Liquid)"
                language="liquid"
                sections={sections}
                readOnly={!canEdit}
                value={content.html}
                onChange={(html) => change({ content: { mode: "code", html } })}
                className="[&_.cm-editor]:min-h-[40svh]"
              />
              <FieldDescription>
                Sees the document's top-level fields: {"{{ principal_name }}"}. Other snippets:{" "}
                {"{% render 'key' %}"}.
              </FieldDescription>
            </Field>
          ) : (
            <DocEditor
              value={content.doc}
              onChange={(doc) => change({ content: { mode: "visual", doc } })}
              sections={sections}
              editable={canEdit}
              snippetId={snippet.id}
              className="min-h-[40svh]"
            />
          )}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Used by</CardTitle>
            <CardDescription>
              Drafts use the current snippet; each published version keeps the copy it was published
              with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {snippet.usedBy.length === 0 && snippet.includedIn.length === 0 && (
              <p className="text-muted-foreground">No template uses it yet.</p>
            )}
            {snippet.usedBy.map((u) => (
              <div key={u.templateId} className="space-y-1">
                <Link
                  to="/templates/$id"
                  params={{ id: u.templateId }}
                  className="font-medium hover:underline"
                >
                  {u.name}
                </Link>
                <div className="flex flex-wrap gap-1">
                  {u.inDraft && <Badge variant="outline">In draft</Badge>}
                  {u.inLatestVersion &&
                    (u.outOfDate ? (
                      <Badge variant="destructive">v{u.latestVersion} out of date</Badge>
                    ) : (
                      <Badge variant="secondary">v{u.latestVersion} up to date</Badge>
                    ))}
                  {!u.inLatestVersion && u.latestVersion !== null && (
                    <Badge variant="outline">Not in v{u.latestVersion}</Badge>
                  )}
                </div>
                {u.outOfDate && (
                  <Link
                    to="/templates/$id"
                    params={{ id: u.templateId }}
                    className="text-xs text-primary hover:underline"
                  >
                    Open to republish
                  </Link>
                )}
              </div>
            ))}
            {snippet.includedIn.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Included in snippets</p>
                {snippet.includedIn.map((s) => (
                  <Link
                    key={s.id}
                    to="/snippets/$id"
                    params={{ id: s.id }}
                    className="block hover:underline"
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
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
    </main>
  );
}
