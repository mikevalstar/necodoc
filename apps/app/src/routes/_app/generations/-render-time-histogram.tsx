import type { RenderTimeHistogram as Histogram } from "@necodoc/shared";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMs } from "./-generation-actions";

// Spec: docs/features/generation-log.md (Render-time histogram). End-to-end times of the filtered
// entries in log-ish buckets. Each bar is a button: pick one, drag across several, or Shift-pick
// to extend, and the table filters to that range. Buckets wholly past p95 are tinted as slow.

export type TimeRange = { slowerThan?: number; fasterThan?: number };
type Bucket = Histogram["buckets"][number];

/** 0.15 → "0.15 s"; the axis reads in seconds. */
const edge = (ms: number) => `${Number((ms / 1000).toFixed(2))} s`;

export const bucketLabel = (bucket: Bucket) =>
  bucket.maxMs === null
    ? `${edge(bucket.minMs)} and over`
    : bucket.minMs === 0
      ? `under ${edge(bucket.maxMs)}`
      : `${edge(bucket.minMs)} to ${edge(bucket.maxMs)}`;

/** The filter for buckets `from`..`to`; the open ends drop out. */
export function rangeOf(buckets: readonly Bucket[], from: number, to: number): TimeRange {
  const low = buckets[Math.min(from, to)];
  const high = buckets[Math.max(from, to)];
  return {
    slowerThan: low && low.minMs > 0 ? low.minMs / 1000 : undefined,
    fasterThan: high?.maxMs != null ? high.maxMs / 1000 : undefined,
  };
}

const overlaps = (bucket: Bucket, range: TimeRange) =>
  (range.fasterThan === undefined || bucket.minMs < range.fasterThan * 1000) &&
  (range.slowerThan === undefined ||
    bucket.maxMs === null ||
    bucket.maxMs > range.slowerThan * 1000);

export function RenderTimeHistogram({
  data,
  range,
  onRange,
}: {
  data: Histogram | undefined;
  range: TimeRange;
  onRange: (range: TimeRange) => void;
}) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const hasRange = range.slowerThan !== undefined || range.fasterThan !== undefined;

  // A drag can end anywhere; a drag across bars sets their range (a click handles one bar).
  useEffect(() => {
    if (!drag) return;
    const end = () => {
      if (data && drag.from !== drag.to) {
        onRange(rangeOf(data.buckets, drag.from, drag.to));
        setAnchor(drag.from);
      }
      setDrag(null);
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, [drag, data, onRange]);

  if (!data) {
    return (
      <section aria-label="Render time distribution" className="rounded-xl bg-card p-4 shadow-card">
        <Skeleton className="h-28 w-full" />
      </section>
    );
  }

  const max = Math.max(1, ...data.buckets.map((b) => b.count));
  const p95 = data.p95Ms;
  /** Buckets wholly past p95 read as slow. */
  const slow = (bucket: Bucket) => p95 !== null && bucket.minMs > p95;
  const preview = drag ? rangeOf(data.buckets, drag.from, drag.to) : null;
  const shownRange = preview ?? range;
  const showsRange = preview !== null || hasRange;
  const inRange = data.buckets
    .filter((b) => overlaps(b, shownRange))
    .reduce((sum, b) => sum + b.count, 0);

  const pick = (i: number, extend: boolean) => {
    const bucket = data.buckets[i];
    if (!bucket) return;
    if (extend && anchor !== null) {
      onRange(rangeOf(data.buckets, anchor, i));
      return;
    }
    const single = rangeOf(data.buckets, i, i);
    const same = single.slowerThan === range.slowerThan && single.fasterThan === range.fasterThan;
    onRange(same ? {} : single);
    setAnchor(same ? null : i);
  };

  return (
    <section
      aria-labelledby="render-times-title"
      className="grid overflow-hidden rounded-xl bg-card shadow-card md:grid-cols-[1fr_13rem]"
    >
      <div className="min-w-0 px-4 pt-3 pb-2">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
          <h2 id="render-times-title" className="text-[13px] font-semibold text-ink-2">
            Render time, end to end
            <span className="sr-only">
              . Pick a bar to filter to its range; drag or Shift-pick to take several.
            </span>
          </h2>
          {showsRange && (
            <div
              className="flex items-center gap-1 font-mono text-xs text-brand-ink"
              aria-live="polite"
            >
              {rangeText(shownRange)} · {inRange.toLocaleString()}
              {hasRange && !preview && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear the render time range"
                  onClick={() => {
                    onRange({});
                    setAnchor(null);
                  }}
                >
                  <XIcon weight="bold" />
                </Button>
              )}
            </div>
          )}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset can't be a flex row in every browser */}
        <div
          role="group"
          aria-label="Render time buckets"
          className="flex h-24 touch-none items-end gap-1 select-none"
        >
          {data.buckets.map((bucket, i) => {
            const selected = showsRange && overlaps(bucket, shownRange);
            const label = `${bucketLabel(bucket)}: ${bucket.count.toLocaleString()} ${bucket.count === 1 ? "generation" : "generations"}`;
            return (
              <button
                key={bucket.minMs}
                type="button"
                aria-label={label}
                aria-pressed={hasRange ? overlaps(bucket, range) : false}
                title={label}
                className="group flex h-full min-w-0 flex-1 items-end rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onPointerDown={(e) => {
                  if (e.button === 0 && !e.shiftKey) setDrag({ from: i, to: i });
                }}
                onPointerEnter={() => drag && setDrag({ ...drag, to: i })}
                onClick={(e) => pick(i, e.shiftKey)}
              >
                <span
                  className={cn(
                    "block w-full rounded-t-[3px] transition-opacity group-hover:opacity-100",
                    slow(bucket) ? "bg-sun" : "bg-brand",
                    showsRange && !selected && "opacity-35",
                    bucket.count === 0 && "bg-hair",
                  )}
                  style={{
                    height: bucket.count === 0 ? 2 : `max(3px, ${(bucket.count / max) * 100}%)`,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div aria-hidden className="mt-1 flex gap-1 font-mono text-[10px] text-ink-3">
          {data.buckets.map((bucket, i) => (
            <span key={bucket.minMs} className="min-w-0 flex-1 truncate">
              {/* Every other edge keeps the axis readable at tablet width. */}
              {i % 2 === 0
                ? bucket.maxMs === null
                  ? `${edge(bucket.minMs)}+`
                  : edge(bucket.minMs)
                : ""}
            </span>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-[1fr_auto] content-center gap-x-3 gap-y-1 border-t border-hair px-4 py-3 font-mono text-xs text-ink-3 md:border-t-0 md:border-l">
        <dt>p50</dt>
        <dd className="text-right text-ink">{formatMs(data.p50Ms)}</dd>
        <dt>p95</dt>
        <dd className="text-right text-warn">{formatMs(data.p95Ms)}</dd>
        <dt>p99</dt>
        <dd className="text-right text-ink">{formatMs(data.p99Ms)}</dd>
        <dt>failed</dt>
        <dd className={cn("text-right", data.failed > 0 ? "text-bad" : "text-ink")}>
          {data.failed.toLocaleString()}
        </dd>
        <dt>timed</dt>
        <dd className="text-right text-ink">{data.timed.toLocaleString()}</dd>
      </dl>
    </section>
  );
}

function rangeText({ slowerThan, fasterThan }: TimeRange) {
  const s = (seconds: number) => `${Number(seconds.toFixed(3))} s`;
  if (slowerThan !== undefined && fasterThan !== undefined)
    return `${s(slowerThan)} – ${s(fasterThan)}`;
  if (slowerThan !== undefined) return `≥ ${s(slowerThan)}`;
  if (fasterThan !== undefined) return `< ${s(fasterThan)}`;
  return "";
}
