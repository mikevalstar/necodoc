import {
  type ErasureReport,
  type SubjectGeneration,
  type SubjectMatches,
  type SubjectSubmission,
  subjectSearchSchema,
} from "@necodoc/shared";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ErrorAlert } from "@/components/form";
import { FaqLink, Page, PageHeader } from "@/components/page";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { plural } from "@/lib/utils";

// Spec: docs/features/personal-data-masking-and-erasure.md (Admin > Data subjects). Search, untick
// false positives, erase, keep the report.

export const Route = createFileRoute("/_app/admin/privacy")({
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: DataSubjects,
});

const generationMatchLabels = {
  subject: "Subject key",
  value: "Stored value",
  packet: "Packet of a match",
} satisfies Record<SubjectGeneration["matchedBy"], string>;

const submissionMatchLabels = {
  respondent_email: "Respondent email",
  value: "Answer",
} satisfies Record<SubjectSubmission["matchedBy"], string>;

const day = (at: string) => dayjs(at).format("YYYY-MM-DD HH:mm");

function downloadReport(report: ErasureReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `erasure-${report.erasedAt.slice(0, 19).replace(/:/g, "")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Toggles one id in a set, or all of `ids` at once. */
function toggled(set: ReadonlySet<string>, ids: string[], on: boolean) {
  const next = new Set(set);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

function DataSubjects() {
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<{ q: string; matches: SubjectMatches } | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<ErasureReport | null>(null);

  const search = useMutation({
    mutationFn: async (term: string) =>
      (await ok(api.privacy.subjects.search.$post({ json: { q: term } }))).json(),
    onSuccess: (matches, term) => {
      setSearched({ q: term, matches });
      setPicked(new Set([...matches.generations, ...matches.submissions].map((m) => m.id)));
      setReport(null);
    },
  });

  const erase = useMutation({
    mutationFn: async () => {
      if (!searched) throw new Error("Search first");
      const json = {
        q: searched.q,
        generationIds: searched.matches.generations
          .filter((g) => picked.has(g.id))
          .map((g) => g.id),
        submissionIds: searched.matches.submissions
          .filter((s) => picked.has(s.id))
          .map((s) => s.id),
      };
      return (await ok(api.privacy.erasures.$post({ json }))).json();
    },
    onSuccess: (erased) => {
      setReport(erased);
      setSearched(null);
      setConfirming(false);
    },
  });

  const invalid = q.trim() !== "" && !subjectSearchSchema.safeParse({ q }).success;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (subjectSearchSchema.safeParse({ q }).success) search.mutate(q.trim());
  };

  const generations = searched?.matches.generations ?? [];
  const submissions = searched?.matches.submissions ?? [];
  const pickedCount = [...generations, ...submissions].filter((m) => picked.has(m.id)).length;

  return (
    <Page>
      <PageHeader
        title="Data subjects"
        description="Find everything stored about one person and erase it: generations (input and PDF), packets built from them, documents and share-link responses. The audit log records the erasure with counts only."
        actions={<FaqLink feature="Data subjects (GDPR erasure)" />}
      />

      <form onSubmit={submit}>
        <Field className="max-w-xl">
          <FieldLabel htmlFor="subject-q">Email, name or identifier</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="subject-q"
              value={q}
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby="subject-q-help"
              onChange={(e) => setQ(e.target.value)}
            />
            <Button type="submit" disabled={search.isPending || q.trim().length < 3}>
              {search.isPending ? "Searching…" : "Search"}
            </Button>
          </div>
          <FieldDescription id="subject-q-help">
            Matches the subject key or a whole stored value, ignoring case. At least 3 characters.
          </FieldDescription>
        </Field>
      </form>
      <ErrorAlert error={search.error} />

      {report && (
        <Alert>
          <AlertTitle>Erased</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {plural(report.generationIds.length, "generation")} (
              {plural(report.files, "stored file")}),{" "}
              {plural(
                report.submissionIds.length,
                "document or response",
                "documents and responses",
              )}
              , {plural(report.webhookDeliveries, "webhook delivery", "webhook deliveries")} and{" "}
              {plural(report.downloadLinks, "signed-link record")} deleted on {day(report.erasedAt)}
              .
            </p>
            {report.objectsLeftBehind > 0 && (
              <p className="text-destructive">
                The storage driver failed to delete {plural(report.objectsLeftBehind, "object")}.
                Their rows are gone; check the API log for "storage: objects left behind".
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => downloadReport(report)}>
              <DownloadSimpleIcon />
              Download report (JSON)
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {searched && (
        <>
          {searched.matches.truncated && (
            <Alert>
              <AlertTitle>More matches than shown</AlertTitle>
              <AlertDescription>
                Only the first 500 of each kind are listed. Erase these, then search again.
              </AlertDescription>
            </Alert>
          )}
          <MatchTable
            title="Generations"
            ids={generations.map((g) => g.id)}
            picked={picked}
            onPick={(ids, on) => setPicked((set) => toggled(set, ids, on))}
            head={["Generated", "File", "Template", "User", "Subject", "Matched by"]}
            rows={generations.map((g) => ({
              id: g.id,
              cells: [
                day(g.queuedAt),
                <Link
                  key="file"
                  to="/generations/$id"
                  params={{ id: g.id }}
                  className="hover:underline"
                >
                  {g.filename}
                </Link>,
                g.templateName ?? "HTML",
                g.userName ?? "—",
                g.subject ?? "—",
                <Badge key="by" variant="outline">
                  {generationMatchLabels[g.matchedBy]}
                </Badge>,
              ],
            }))}
          />
          <MatchTable
            title="Documents and share-link responses"
            ids={submissions.map((s) => s.id)}
            picked={picked}
            onPick={(ids, on) => setPicked((set) => toggled(set, ids, on))}
            head={["Created", "Name", "Owner", "Respondent", "Status", "Matched by"]}
            rows={submissions.map((s) => ({
              id: s.id,
              cells: [
                day(s.createdAt),
                s.name,
                s.ownerName ?? "—",
                s.respondentEmail ?? "—",
                s.status,
                <Badge key="by" variant="outline">
                  {submissionMatchLabels[s.matchedBy]}
                </Badge>,
              ],
            }))}
          />
          <div className="flex items-center gap-3">
            <Button
              variant="destructive"
              disabled={pickedCount === 0}
              onClick={() => setConfirming(true)}
            >
              Erase {pickedCount} selected
            </Button>
            {generations.length + submissions.length === 0 && (
              <span className="text-sm text-muted-foreground">Nothing matches.</span>
            )}
          </div>
        </>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Erase {pickedCount} {pickedCount === 1 ? "item" : "items"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected generations, their PDFs and stored files, packets, documents and
              responses are deleted for good. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorAlert error={erase.error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={erase.isPending}
              onClick={() => erase.mutate()}
            >
              {erase.isPending ? "Erasing…" : "Erase"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function MatchTable({
  title,
  ids,
  picked,
  onPick,
  head,
  rows,
}: {
  title: string;
  ids: string[];
  picked: ReadonlySet<string>;
  onPick: (ids: string[], on: boolean) => void;
  head: string[];
  rows: { id: string; cells: React.ReactNode[] }[];
}) {
  const all = ids.length > 0 && ids.every((id) => picked.has(id));
  return (
    <section className="space-y-2">
      <h2 className="font-medium">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="Select all"
                    checked={all}
                    onCheckedChange={(on) => onPick(ids, on)}
                  />
                </TableHead>
                {head.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox
                      aria-label="Select"
                      checked={picked.has(row.id)}
                      onCheckedChange={(on) => onPick([row.id], on)}
                    />
                  </TableCell>
                  {row.cells.map((cell, i) => (
                    <TableCell key={head[i]} className="max-w-64 truncate">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
