import {
  type ErasureReport,
  type SubjectGeneration,
  type SubjectMatches,
  type SubjectSubmission,
  subjectSearchSchema,
} from "@necodoc/shared";
import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type FormEvent, type MouseEvent, type ReactNode, useState } from "react";
import { ErrorAlert } from "@/components/form";
import { CardBar, EmptyState, FaqLink, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { cn, plural } from "@/lib/utils";
import { DocumentStatusBadge } from "../documents/-document-actions";
import { StatusBadge } from "../generations/-generation-actions";

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

/** The word typed to confirm an erasure. */
const CONFIRM_WORD = "erase";

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

/** "2 generations, 1 packet and 3 documents", skipping the kinds with none. */
function summary(counts: { generations: number; packets: number; submissions: number }) {
  const parts = [
    counts.generations && plural(counts.generations, "generation"),
    counts.packets && plural(counts.packets, "packet"),
    counts.submissions &&
      plural(counts.submissions, "document or response", "documents and responses"),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
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

  const valid = subjectSearchSchema.safeParse({ q }).success;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) search.mutate(q.trim());
  };

  const all = searched?.matches.generations ?? [];
  const generations = all.filter((g) => g.matchedBy !== "packet");
  const packets = all.filter((g) => g.matchedBy === "packet");
  const submissions = searched?.matches.submissions ?? [];
  const count = (rows: { id: string }[]) => rows.filter((r) => picked.has(r.id)).length;
  const counts = {
    generations: count(generations),
    packets: count(packets),
    submissions: count(submissions),
  };
  const pickedCount = counts.generations + counts.packets + counts.submissions;
  const total = all.length + submissions.length;
  const onPick = (ids: string[], on: boolean) => setPicked((set) => toggled(set, ids, on));

  return (
    <Page>
      <PageHeader
        title="Data subjects"
        description="Find everything necodoc stores about one person, untick anything that isn't them, and erase the rest. The audit log records each erasure with counts only."
        actions={<FaqLink feature="Data subjects (GDPR erasure)" />}
      />

      <Card className="px-5">
        <form onSubmit={submit}>
          <Field className="max-w-2xl">
            <FieldLabel htmlFor="subject-q">Email, name or identifier</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="subject-q"
                value={q}
                autoComplete="off"
                spellCheck={false}
                placeholder="ada@example.com"
                aria-describedby="subject-q-help"
                onChange={(e) => setQ(e.target.value)}
              />
              <Button type="submit" disabled={search.isPending || !valid}>
                <MagnifyingGlassIcon weight="bold" />
                {search.isPending ? "Searching…" : "Search"}
              </Button>
            </div>
            <FieldDescription id="subject-q-help" className="text-ink-3">
              Matches the subject key, a respondent's email or a whole stored value, ignoring case.
              At least 3 characters. Nothing is deleted until you confirm.
            </FieldDescription>
          </Field>
        </form>
      </Card>
      <ErrorAlert error={search.error} />

      {report && <ReportCard report={report} onDone={() => setReport(null)} />}

      {searched && total === 0 && (
        <EmptyState
          icon={MagnifyingGlassIcon}
          title={`Nothing matches “${searched.q}”`}
          description="Search compares whole values only. Try the exact email, customer number or name as it was entered."
        />
      )}

      {searched && total > 0 && (
        <section aria-labelledby="matches-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="matches-heading" className="font-heading text-xl font-bold tracking-tight">
              {plural(total, "match", "matches")} for{" "}
              <span className="font-mono text-[17px] font-normal break-all">{searched.q}</span>
            </h2>
            <p className="text-sm text-ink-3">
              Everything starts selected. Untick anything that belongs to someone else.
            </p>
          </div>

          {searched.matches.truncated && (
            <Alert>
              <WarningIcon className="text-warn" />
              <AlertTitle>More matches than shown</AlertTitle>
              <AlertDescription className="text-ink-2">
                Only the first 500 of each kind are listed. Erase these, then search again.
              </AlertDescription>
            </Alert>
          )}

          <MatchCard
            title="Generations"
            description="Each one's input, PDF and stored file, webhook delivery logs and signed links."
            rows={generations}
            label={(g) => g.filename}
            picked={picked}
            onPick={onPick}
            columns={[
              { head: "Generated", cell: (g) => <When at={g.queuedAt} /> },
              {
                head: "File",
                cell: (g) => (
                  <Link
                    to="/generations/$id"
                    params={{ id: g.id }}
                    className="font-semibold hover:underline"
                  >
                    {g.filename}
                  </Link>
                ),
              },
              { head: "Template", cell: (g) => g.templateName ?? "HTML", hide: "lg" },
              { head: "User", cell: (g) => g.userName ?? "—", hide: "xl" },
              { head: "Subject", cell: (g) => g.subject ?? "—" },
              {
                head: "Matched by",
                cell: (g) => <MatchedBy>{generationMatchLabels[g.matchedBy]}</MatchedBy>,
              },
            ]}
          />
          <MatchCard
            title="Packets"
            description="Combined PDFs built from a matching generation. They contain its pages."
            rows={packets}
            label={(g) => g.filename}
            picked={picked}
            onPick={onPick}
            columns={[
              { head: "Generated", cell: (g) => <When at={g.queuedAt} /> },
              {
                head: "File",
                cell: (g) => (
                  <Link
                    to="/generations/$id"
                    params={{ id: g.id }}
                    className="font-semibold hover:underline"
                  >
                    {g.filename}
                  </Link>
                ),
              },
              { head: "User", cell: (g) => g.userName ?? "—", hide: "lg" },
              { head: "Status", cell: (g) => <StatusBadge status={g.status} /> },
            ]}
          />
          <MatchCard
            title="Documents and share-link responses"
            description="Their answers. A finished document's PDF is listed under generations."
            rows={submissions}
            label={(s) => s.name}
            picked={picked}
            onPick={onPick}
            columns={[
              { head: "Created", cell: (s) => <When at={s.createdAt} /> },
              { head: "Name", cell: (s) => <span className="font-semibold">{s.name}</span> },
              { head: "Owner", cell: (s) => s.ownerName ?? "—", hide: "xl" },
              { head: "Respondent", cell: (s) => s.respondentEmail ?? "—", hide: "lg" },
              {
                head: "Status",
                cell: (s) => <DocumentStatusBadge status={s.status} generationStatus={null} />,
              },
              {
                head: "Matched by",
                cell: (s) => <MatchedBy>{submissionMatchLabels[s.matchedBy]}</MatchedBy>,
              },
            ]}
          />

          <Card className="sticky bottom-4 z-10 flex-row flex-wrap items-center gap-3 px-5 py-3.5 shadow-float">
            <p className="min-w-0 flex-1 text-sm" aria-live="polite">
              {pickedCount === 0 ? (
                <span className="text-ink-3">Nothing selected.</span>
              ) : (
                <>
                  <span className="font-semibold">
                    {pickedCount} of {total}
                  </span>{" "}
                  <span className="text-ink-2">selected: {summary(counts)}.</span>
                </>
              )}
            </p>
            <Button
              variant="destructive"
              disabled={pickedCount === 0}
              onClick={() => {
                erase.reset();
                setConfirming(true);
              }}
            >
              Erase selected…
            </Button>
          </Card>
        </section>
      )}

      <ConfirmErase
        open={confirming}
        onOpenChange={setConfirming}
        counts={counts}
        pickedCount={pickedCount}
        q={searched?.q ?? ""}
        pending={erase.isPending}
        error={erase.error}
        onErase={() => erase.mutate()}
      />
    </Page>
  );
}

function When({ at }: { at: string }) {
  return <span className="font-mono text-[13px] whitespace-nowrap text-ink-2">{day(at)}</span>;
}

function MatchedBy({ children }: { children: ReactNode }) {
  return <Badge variant="secondary">{children}</Badge>;
}

const hidden = { lg: "max-lg:hidden", xl: "max-xl:hidden" } as const;

type Column<T> = { head: string; cell: (row: T) => ReactNode; hide?: keyof typeof hidden };

/** One kind of match: a card with a select-all header and a row per match. Renders nothing when empty. */
function MatchCard<T extends { id: string }>({
  title,
  description,
  rows,
  columns,
  label,
  picked,
  onPick,
}: {
  title: string;
  description: string;
  rows: T[];
  columns: Column<T>[];
  /** Names the row for its checkbox. */
  label: (row: T) => string;
  picked: ReadonlySet<string>;
  onPick: (ids: string[], on: boolean) => void;
}) {
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.id);
  const selected = ids.filter((id) => picked.has(id)).length;
  // Clicking anywhere on a row toggles it, except on its links and the checkbox itself.
  const rowClick = (id: string) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button, [role=checkbox]")) return;
    onPick([id], !picked.has(id));
  };
  return (
    <Card className="gap-0 py-0">
      <CardBar
        title={
          <>
            {title} <span className="font-normal text-ink-3 tabular-nums">({rows.length})</span>
          </>
        }
        description={description}
        meta={`${selected} of ${rows.length} selected`}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <Checkbox
                aria-label={`Select all ${title.toLowerCase()}`}
                checked={selected === rows.length}
                onCheckedChange={(on) => onPick(ids, on)}
              />
            </TableHead>
            {columns.map((c) => (
              <TableHead key={c.head} className={c.hide && hidden[c.hide]}>
                {c.head}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const on = picked.has(row.id);
            return (
              <TableRow
                key={row.id}
                onClick={rowClick(row.id)}
                className={cn("cursor-pointer", !on && "text-ink-3")}
              >
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Erase ${label(row)}`}
                    checked={on}
                    onCheckedChange={(next) => onPick([row.id], next)}
                  />
                </TableCell>
                {columns.map((c) => (
                  <TableCell
                    key={c.head}
                    className={cn("max-w-64 truncate", c.hide && hidden[c.hide])}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function ConfirmErase({
  open,
  onOpenChange,
  counts,
  pickedCount,
  q,
  pending,
  error,
  onErase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: { generations: number; packets: number; submissions: number };
  pickedCount: number;
  q: string;
  pending: boolean;
  error: Error | null;
  onErase: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (confirmed && !pending) onErase();
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setTyped("");
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Erase {plural(pickedCount, "match", "matches")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything selected for <span className="font-mono break-all">{q}</span> is deleted
              for good. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5 rounded-lg bg-tint px-4 py-3 text-sm">
            {counts.generations > 0 && (
              <li>
                <span className="font-semibold">{plural(counts.generations, "generation")}</span>
                <span className="text-ink-2">
                  : input, PDF, stored file, webhook logs and signed links
                </span>
              </li>
            )}
            {counts.packets > 0 && (
              <li>
                <span className="font-semibold">{plural(counts.packets, "packet")}</span>
                <span className="text-ink-2">: the combined PDF and its stored file</span>
              </li>
            )}
            {counts.submissions > 0 && (
              <li>
                <span className="font-semibold">
                  {plural(counts.submissions, "document or response", "documents and responses")}
                </span>
                <span className="text-ink-2">: their answers</span>
              </li>
            )}
          </ul>
          <p className="text-sm text-ink-3">
            Unticked matches are kept. You can download a report of what was erased afterwards.
          </p>
          <Field>
            <FieldLabel htmlFor="erase-confirm">
              Type <span className="font-mono">{CONFIRM_WORD}</span> to confirm
            </FieldLabel>
            <Input
              id="erase-confirm"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <ErrorAlert error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
              {pending ? "Erasing…" : `Erase ${plural(pickedCount, "match", "matches")}`}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReportCard({ report, onDone }: { report: ErasureReport; onDone: () => void }) {
  const tiles = [
    ["Generations and packets", report.generationIds.length],
    ["Documents and responses", report.submissionIds.length],
    ["Stored files", report.files],
    ["Webhook deliveries", report.webhookDeliveries],
    ["Signed links", report.downloadLinks],
  ] as const;
  return (
    <Card className="gap-4 px-5" role="status">
      <div className="flex flex-wrap items-start gap-3">
        <CheckCircleIcon className="mt-0.5 size-6 shrink-0 text-ok" />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[17px] font-bold tracking-tight">Erasure complete</h2>
          <p className="text-sm text-ink-3">
            Deleted <span className="font-mono">{day(report.erasedAt)}</span>. Download the report
            for your records; this page won't show it again once you leave.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onDone}>
            Done
          </Button>
          <Button onClick={() => downloadReport(report)}>
            <DownloadSimpleIcon />
            Download report (JSON)
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, n]) => (
          <div key={label} className="rounded-lg bg-tint px-3.5 py-2.5">
            <dt className="text-[12.5px] font-semibold text-ink-3">{label}</dt>
            <dd className="font-heading text-[22px] leading-tight font-extrabold tabular-nums">
              {n}
            </dd>
          </div>
        ))}
      </dl>
      {report.objectsLeftBehind > 0 && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>
            The storage driver failed to delete {plural(report.objectsLeftBehind, "object")}
          </AlertTitle>
          <AlertDescription>
            Their rows are gone. Check the API log for "storage: objects left behind".
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
