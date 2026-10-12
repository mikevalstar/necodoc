import {
  type TestAssertions,
  type TestCaseFrom,
  type TestResult,
  testAssertionsSchema,
} from "@necodoc/shared";
import { CheckCircleIcon, FlaskIcon, PlayIcon, PlusIcon, XCircleIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/form";
import { EmptyState, ListSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/template-test-cases-and-visual-diff.md. Named data sets with assertions,
// run on the saved draft.

export const testCasesQuery = (id: string) =>
  queryOptions({
    queryKey: ["templates", id, "tests"],
    queryFn: async () => (await ok(api.templates[":id"].tests.$get({ param: { id } }))).json(),
  });

/** Runs every case on the saved draft; `draftUpdatedAt` keys it so a save runs them again. */
export const testRunQuery = (id: string, draftUpdatedAt: string) =>
  queryOptions({
    queryKey: ["templates", id, "tests", "run", draftUpdatedAt],
    queryFn: async () =>
      (await ok(api.templates[":id"].tests.run.$post({ param: { id }, json: {} }))).json(),
    staleTime: 5 * 60_000,
    retry: false,
  });

/** "3 of 4 passing", or null with no cases. */
export function testSummary(results: readonly TestResult[] | undefined) {
  if (!results?.length) return null;
  const passed = results.filter((r) => r.passed).length;
  return { passed, total: results.length, allPassed: passed === results.length };
}

export function TestResults({ results }: { results: readonly TestResult[] }) {
  return (
    <ul className="space-y-2">
      {results.map((r) => (
        <li key={r.caseId} className="rounded-lg bg-tint px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            {r.passed ? (
              <CheckCircleIcon className="size-4 text-ok" aria-label="Passed" />
            ) : (
              <XCircleIcon className="size-4 text-bad" aria-label="Failed" />
            )}
            <span className="font-medium">{r.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {r.pageCount !== null && `${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"} · `}
              {r.durationMs} ms
            </span>
          </div>
          <ul className="mt-1 space-y-0.5 pl-6 text-xs">
            {r.checks
              .filter((check) => !r.passed || check.label !== "Renders without error")
              .map((check) => (
                <li key={check.label} className={check.passed ? "text-ink-3" : "text-bad"}>
                  {check.passed ? "✓" : "✗"} {check.label}
                  {check.detail && `: ${check.detail}`}
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Test results for the saved draft; runs on open and after each save. */
export function TestRun({ id, draftUpdatedAt }: { id: string; draftUpdatedAt: string }) {
  const run = useQuery(testRunQuery(id, draftUpdatedAt));
  const summary = testSummary(run.data?.results);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span role="status" className="text-ink-3">
          {run.isFetching ? (
            "Running tests…"
          ) : summary ? (
            <Badge dot variant={summary.allPassed ? "ok" : "bad"}>
              {summary.passed} of {summary.total} passing
            </Badge>
          ) : run.data ? (
            "No test cases to run."
          ) : (
            ""
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={run.isFetching}
          onClick={() => run.refetch()}
        >
          <PlayIcon />
          Run tests
        </Button>
      </div>
      <ErrorAlert error={run.error} />
      {run.data && <TestResults results={run.data.results} />}
    </div>
  );
}

type TestCase = InferResponseType<(typeof api.templates)[":id"]["tests"]["$get"], 200>[number];

const sourceLabels: Record<TestCase["source"], string> = {
  sample: "Sample data",
  data: "JSON",
  generation: "Generation",
  submission: "Document",
};

function assertionsText(a: TestAssertions) {
  return [
    a.validates && "validates",
    a.noTextCut && "no text cut",
    a.pageCount && `${a.pageCount.op === "equals" ? "pages =" : "pages ≤"} ${a.pageCount.value}`,
    ...a.contains.map((t) => `contains "${t}"`),
    ...a.notContains.map((t) => `no "${t}"`),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The Tests tab of the template editor. */
export function TestsPanel({
  id,
  draftUpdatedAt,
  canEdit,
  dirty,
}: {
  id: string;
  draftUpdatedAt: string;
  canEdit: boolean;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const cases = useQuery(testCasesQuery(id));
  const [editing, setEditing] = useState<TestCase | "new" | null>(null);
  const [deleting, setDeleting] = useState<TestCase | null>(null);
  const remove = useMutation({
    mutationFn: (caseId: string) =>
      ok(api.templates[":id"].tests[":caseId"].$delete({ param: { id, caseId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates", id, "tests"] });
      toast.success(`Deleted test case ${deleting?.name ?? ""}`.trim());
      setDeleting(null);
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-ink-2">
          Named data the saved draft is checked with before review and publish.
          {dirty && " Save to test your latest changes."}
        </p>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <PlusIcon weight="bold" />
            New test case
          </Button>
        )}
      </div>
      <ErrorAlert error={cases.error} />
      {cases.isPending && <ListSkeleton rows={2} />}
      {cases.data?.length === 0 && (
        <EmptyState
          icon={FlaskIcon}
          title="No test cases yet"
          description="Save a data set with checks (page count, text it must or mustn't contain) to catch a template change that breaks a document."
        />
      )}
      {cases.data?.map((c) => (
        <div key={c.id} className="flex flex-wrap items-start gap-2 rounded-xl bg-tint p-3 text-sm">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <Badge variant="secondary">{sourceLabels[c.source]}</Badge>
            </div>
            <p className="text-xs text-ink-3">
              {assertionsText(testAssertionsSchema.parse(c.assertions)) || "renders"} · updated{" "}
              {dayjs(c.updatedAt).fromNow()}
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleting(c)}>
                Delete…
              </Button>
            </div>
          )}
        </div>
      ))}
      {!!cases.data?.length && <TestRun id={id} draftUpdatedAt={draftUpdatedAt} />}
      {editing && (
        <TestCaseDialog
          id={id}
          testCase={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete test case ${deleting.name}?`}
          description="Its data and checks are removed; publishing no longer runs it. It can't be undone."
          confirmLabel="Delete test case"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const objectSchema = z.record(z.string(), z.unknown());

function TestCaseDialog({
  id,
  testCase,
  onClose,
}: {
  id: string;
  testCase: TestCase | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = testAssertionsSchema.parse(testCase?.assertions ?? {});
  const [name, setName] = useState(testCase?.name ?? "");
  const [from, setFrom] = useState<TestCaseFrom["kind"]>("sample");
  const [sourceId, setSourceId] = useState("");
  const [json, setJson] = useState(testCase ? JSON.stringify(testCase.data, null, 2) : "{}");
  const [validates, setValidates] = useState(initial.validates);
  const [noTextCut, setNoTextCut] = useState(initial.noTextCut);
  const [pageOp, setPageOp] = useState(initial.pageCount?.op ?? "");
  const [pages, setPages] = useState(String(initial.pageCount?.value ?? 1));
  const [contains, setContains] = useState(initial.contains.join("\n"));
  const [notContains, setNotContains] = useState(initial.notContains.join("\n"));
  const sources = useQuery({
    queryKey: ["templates", id, "tests", "sources"],
    queryFn: async () =>
      (await ok(api.templates[":id"].tests.sources.$get({ param: { id } }))).json(),
    enabled: !testCase,
  });

  const save = useMutation({
    mutationFn: async () => {
      const assertions = testAssertionsSchema.parse({
        validates,
        noTextCut,
        pageCount:
          pageOp === "equals" || pageOp === "at_most" ? { op: pageOp, value: Number(pages) } : null,
        contains: lines(contains),
        notContains: lines(notContains),
      });
      const parsedData = () => {
        const data = objectSchema.safeParse(JSON.parse(json));
        if (!data.success) throw new Error("The data must be a JSON object");
        return data.data;
      };
      if (testCase) {
        return ok(
          api.templates[":id"].tests[":caseId"].$patch({
            param: { id, caseId: testCase.id },
            json: { name, assertions, data: parsedData() },
          }),
        );
      }
      const source: TestCaseFrom =
        from === "data"
          ? { kind: "data", data: parsedData() }
          : from === "sample"
            ? { kind: "sample" }
            : { kind: from, id: sourceId };
      return ok(
        api.templates[":id"].tests.$post({
          param: { id },
          json: { name, from: source, assertions },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["templates", id, "tests"] });
      onClose();
    },
  });

  const options =
    from === "generation"
      ? (sources.data?.generations ?? []).map((g) => ({
          id: g.id,
          label: `${g.filename} · ${g.source} · ${dayjs(g.queuedAt).format("MMM D, h:mm A")}`,
        }))
      : (sources.data?.documents ?? []).map((d) => ({
          id: d.id,
          label: `${d.name} · ${dayjs(d.updatedAt).format("MMM D, h:mm A")}`,
        }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{testCase ? `Edit ${testCase.name}` : "New test case"}</DialogTitle>
            <DialogDescription>
              Rendering without an error is always checked; the rest is optional.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="case-name">Name</FieldLabel>
              <Input
                id="case-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Long address, no rider"
              />
            </Field>
            {!testCase && (
              <Field>
                <FieldLabel htmlFor="case-from">Data from</FieldLabel>
                <NativeSelect
                  id="case-from"
                  value={from}
                  onChange={(e) => {
                    setFrom(
                      z.enum(["sample", "data", "generation", "submission"]).parse(e.target.value),
                    );
                    setSourceId("");
                  }}
                >
                  <NativeSelectOption value="sample">The draft's sample data</NativeSelectOption>
                  <NativeSelectOption value="generation">A past generation</NativeSelectOption>
                  <NativeSelectOption value="submission">One of my documents</NativeSelectOption>
                  <NativeSelectOption value="data">JSON I paste</NativeSelectOption>
                </NativeSelect>
              </Field>
            )}
            {!testCase && (from === "generation" || from === "submission") && (
              <Field>
                <FieldLabel htmlFor="case-source">
                  {from === "generation" ? "Generation" : "Document"}
                </FieldLabel>
                <NativeSelect
                  id="case-source"
                  required
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  <NativeSelectOption value="">
                    {options.length ? "Pick one" : "None for this template"}
                  </NativeSelectOption>
                  {options.map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {(testCase || from === "data") && (
              <Field>
                <FieldLabel htmlFor="case-json">Data (JSON)</FieldLabel>
                <Textarea
                  id="case-json"
                  rows={8}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
              </Field>
            )}
            <Field orientation="horizontal">
              <Checkbox
                id="case-validates"
                checked={validates}
                onCheckedChange={(v) => setValidates(v)}
              />
              <FieldLabel htmlFor="case-validates" className="font-normal">
                Data validates against the fields
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="case-text-cut"
                checked={noTextCut}
                onCheckedChange={(v) => setNoTextCut(v)}
              />
              <FieldLabel htmlFor="case-text-cut" className="font-normal">
                No overlay text cut to fit
              </FieldLabel>
            </Field>
            <div className="flex items-end gap-2">
              <Field className="w-44">
                <FieldLabel htmlFor="case-page-op">Page count</FieldLabel>
                <NativeSelect
                  id="case-page-op"
                  value={pageOp}
                  onChange={(e) => setPageOp(e.target.value)}
                >
                  <NativeSelectOption value="">Any</NativeSelectOption>
                  <NativeSelectOption value="equals">Equals</NativeSelectOption>
                  <NativeSelectOption value="at_most">At most</NativeSelectOption>
                </NativeSelect>
              </Field>
              {pageOp && (
                <Input
                  aria-label="Pages"
                  type="number"
                  min={1}
                  className="w-24"
                  value={pages}
                  onChange={(e) => setPages(e.target.value)}
                />
              )}
            </div>
            <Field>
              <FieldLabel htmlFor="case-contains">Text it contains</FieldLabel>
              <Textarea
                id="case-contains"
                rows={2}
                value={contains}
                onChange={(e) => setContains(e.target.value)}
              />
              <FieldDescription>One per line, any page.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="case-not-contains">Text it doesn't contain</FieldLabel>
              <Textarea
                id="case-not-contains"
                rows={2}
                value={notContains}
                onChange={(e) => setNotContains(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <ErrorAlert error={save.error} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {testCase ? "Save" : "Add test case"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
