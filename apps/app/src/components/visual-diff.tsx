import { diffLines, PAGE_CHANGED_PERCENT, type PageDiff } from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, ok } from "@/lib/api";
import { cn } from "@/lib/utils";

// Spec: docs/features/template-test-cases-and-visual-diff.md. The latest published version and
// the saved draft rendered with the same data; the API rasterises and compares the pages.

type Mode = "side" | "overlay" | "diff" | "text";
const modes: { value: Mode; label: string }[] = [
  { value: "side", label: "Side by side" },
  { value: "overlay", label: "Overlay" },
  { value: "diff", label: "Diff" },
  { value: "text", label: "Text" },
];

const changed = (page: PageDiff) => page.changedPercent > PAGE_CHANGED_PERCENT;

export function VisualDiff({
  templateId,
  cases,
  /** Part of the cache key: a new draft save compares again. */
  draftUpdatedAt,
}: {
  templateId: string;
  cases: readonly { id: string; name: string }[];
  draftUpdatedAt: string;
}) {
  const [caseId, setCaseId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("side");
  const [selected, setSelected] = useState(1);
  const diff = useQuery({
    queryKey: ["templates", templateId, "visual-diff", caseId, draftUpdatedAt],
    queryFn: async () =>
      (
        await ok(
          api.templates[":id"]["visual-diff"].$post({
            param: { id: templateId },
            json: caseId ? { caseId } : {},
          }),
        )
      ).json(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pages = diff.data?.pages ?? [];
  const page = pages.find((p) => p.page === selected) ?? pages[0];
  const changedCount = pages.filter(changed).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-64">
          <FieldLabel htmlFor="diff-case">Data</FieldLabel>
          <NativeSelect
            id="diff-case"
            value={caseId}
            onChange={(e) => {
              setCaseId(e.target.value);
              setSelected(1);
            }}
          >
            <NativeSelectOption value="">Sample data</NativeSelectOption>
            {cases.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <fieldset className="flex flex-wrap gap-1" aria-label="View">
          {modes.map((m) => (
            <Button
              key={m.value}
              size="sm"
              variant={mode === m.value ? "secondary" : "ghost"}
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </Button>
          ))}
        </fieldset>
        <span className="text-sm text-muted-foreground" role="status">
          {diff.isFetching
            ? "Rendering and comparing…"
            : diff.data
              ? diff.data.baseVersion === null
                ? "Not published yet: nothing to compare with."
                : `Draft vs version ${diff.data.baseVersion}: ${changedCount} of ${pages.length} ${pages.length === 1 ? "page" : "pages"} changed${diff.data.truncated ? " (first pages only)" : ""}`
              : ""}
        </span>
      </div>
      <ErrorAlert error={diff.error} />
      {diff.data?.beforeError && (
        <p className="text-sm text-amber-700">
          The published version didn't render with this data: {diff.data.beforeError}
        </p>
      )}
      {page && (
        <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
          <ol className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Pages">
            {pages.map((p) => (
              <li key={p.page}>
                <button
                  type="button"
                  onClick={() => setSelected(p.page)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-sm",
                    p.page === page.page ? "border-primary bg-muted" : "hover:bg-muted",
                  )}
                >
                  Page {p.page}
                  {changed(p) ? (
                    <Badge variant="destructive" className="px-1.5">
                      {p.before && p.after
                        ? `${p.changedPercent.toFixed(p.changedPercent < 1 ? 2 : 1)}%`
                        : p.after
                          ? "new"
                          : "gone"}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">same</span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          <PageView page={page} mode={mode} />
        </div>
      )}
    </div>
  );
}

function PageImage({ src, label }: { src: string | null; label: string }) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {src ? (
        <img src={src} alt={label} className="w-full rounded border bg-white" />
      ) : (
        <div className="flex aspect-[8.5/11] items-center justify-center rounded border text-sm text-muted-foreground">
          No such page
        </div>
      )}
    </figure>
  );
}

function PageView({ page, mode }: { page: PageDiff; mode: Mode }) {
  const [opacity, setOpacity] = useState(50);
  if (mode === "side") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <PageImage src={page.before} label="Published" />
        <PageImage src={page.after} label="Draft" />
      </div>
    );
  }
  if (mode === "diff") {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <span className="text-emerald-700">Green</span>: only in the draft.{" "}
          <span className="text-red-700">Red</span>: only in the published version. Grey: unchanged.{" "}
          {page.changedPixels.toLocaleString()} pixels changed ({page.changedPercent.toFixed(2)}%).
        </p>
        <PageImage src={page.diff ?? page.after ?? page.before} label="Diff" />
      </div>
    );
  }
  if (mode === "overlay") {
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Published
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            aria-label="Draft opacity"
          />
          Draft
        </label>
        <div className="relative">
          {page.before && (
            <img src={page.before} alt="Published" className="w-full rounded border bg-white" />
          )}
          {page.after && (
            <img
              src={page.after}
              alt="Draft"
              style={{ opacity: page.before ? opacity / 100 : 1 }}
              className={cn("w-full rounded border bg-white", page.before && "absolute inset-0")}
            />
          )}
        </div>
      </div>
    );
  }
  const lines = diffLines(page.beforeText, page.afterText);
  return (
    <pre className="max-h-[70svh] overflow-auto rounded border p-2 text-xs whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div
          // Lines repeat; their position is their identity here.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          key={i}
          className={cn(
            line.op === "added" && "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
            line.op === "removed" && "bg-red-500/15 text-red-800 line-through dark:text-red-300",
          )}
        >
          {line.op === "added" ? "+ " : line.op === "removed" ? "- " : "  "}
          {line.item || " "}
        </div>
      ))}
    </pre>
  );
}
