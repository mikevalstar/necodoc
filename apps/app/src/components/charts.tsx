import { type AnalyticsBucket, toCsv } from "@necodoc/shared";
import { DownloadSimpleIcon, TableIcon } from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dayjs } from "@/lib/date";
import { cn } from "@/lib/utils";

// ADR 0034: hand-rolled SVG charts for docs/features/analytics-dashboards.md. Thin marks, hairline
// grid, one y-axis, a legend for two or more series, a tooltip on hover and keyboard focus, and a
// table view on every chart. Colours are the --series-* and --status-* variables (index.css).

/** A fixed categorical slot; a series keeps its slot whatever the filters show. */
export const slot = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => `var(--series-${n})`;
export const otherColor = "var(--series-other)";
export const goodColor = "var(--status-good)";
export const criticalColor = "var(--status-critical)";

export type SeriesDef<K extends string> = { key: K; label: string; color: string };

/** One value per series per bucket; `values[i]` is `buckets[i]`. */
export type TimeData<K extends string> = {
  bucket: AnalyticsBucket;
  buckets: readonly number[];
  series: readonly SeriesDef<K>[];
  values: readonly Map<K, number | null>[];
};

/** Long-form counts (one row per bucket and key) into zero-filled buckets. */
export function countsByBucket<K extends string, R extends { t: number }>(
  bucket: AnalyticsBucket,
  buckets: readonly number[],
  series: readonly SeriesDef<K>[],
  rows: readonly R[],
  key: (row: R) => K,
  value: (row: R) => number,
): TimeData<K> {
  const index = new Map(buckets.map((t, i) => [t, i]));
  const values = buckets.map(() => new Map<K, number | null>(series.map((s) => [s.key, 0])));
  for (const row of rows) {
    const at = values[index.get(row.t) ?? -1];
    if (at) at.set(key(row), (at.get(key(row)) ?? 0) + value(row));
  }
  return { bucket, buckets, series, values };
}

/** Wide rows (one per bucket, a field per series) into buckets; missing ones are gaps. */
export function fieldsByBucket<K extends string>(
  bucket: AnalyticsBucket,
  buckets: readonly number[],
  series: readonly SeriesDef<K>[],
  rows: readonly ({ t: number } & Record<K, number | null>)[],
): TimeData<K> {
  const byT = new Map(rows.map((row) => [row.t, row]));
  const values = buckets.map(
    (t) => new Map<K, number | null>(series.map((s) => [s.key, byT.get(t)?.[s.key] ?? null])),
  );
  return { bucket, buckets, series, values };
}

/** Series with nothing in the range drop out of the legend, tooltip and table; the rest keep their slot. */
const shownSeries = <K extends string>({ series, values }: TimeData<K>) =>
  series.filter((s) => values.some((row) => (row.get(s.key) ?? 0) !== 0));

const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact" });
export const formatCount = (value: number) =>
  value >= 10_000 ? compactFormat.format(value) : value.toLocaleString();

const bucketFormats = {
  hour: "MMM D, HH:00",
  day: "ddd MMM D",
  week: "[Week of] MMM D",
} satisfies Record<AnalyticsBucket, string>;
const tickFormats = { hour: "HH:00", day: "MMM D", week: "MMM D" } satisfies Record<
  AnalyticsBucket,
  string
>;
const formatBucket = (bucket: AnalyticsBucket, t: number) => dayjs(t).format(bucketFormats[bucket]);

/** A clean step near max/4: 1, 2 or 5 times a power of ten; whole numbers for counts. */
function niceTicks(max: number, counts: boolean) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const step = counts ? Math.max(1, nice) : nice;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const PLOT_HEIGHT = 180;
const MARGIN = { top: 8, right: 12, bottom: 24, left: 48 };
const GAP = 2;

/** Rounded top corners, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(6, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Stacked columns or lines over time. `onSelect` makes buckets clickable (drill-through).
 * `format` formats values (axis, tooltip, table).
 */
export function TimeChart<K extends string>({
  data,
  kind,
  format = formatCount,
  onSelect,
  label,
}: {
  data: TimeData<K>;
  kind: "stacked" | "line";
  format?: (value: number) => string;
  onSelect?: (t: number) => void;
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const { buckets, values } = data;
  const series = shownSeries(data);
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const band = buckets.length ? plotWidth / buckets.length : 0;
  const stackTotal = (i: number) =>
    series.reduce((sum, s) => sum + (values[i]?.get(s.key) ?? 0), 0);
  const max =
    kind === "stacked"
      ? Math.max(0, ...buckets.map((_, i) => stackTotal(i)))
      : Math.max(0, ...values.flatMap((row) => [...row.values()].map((v) => v ?? 0)));
  const ticks = niceTicks(max, format === formatCount);
  const top = ticks.at(-1) ?? 1;
  const y = (v: number) => MARGIN.top + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const xCenter = (i: number) => MARGIN.left + band * (i + 0.5);
  // A proportional gap (like the home "Renders today" bars) so 90 buckets still read as columns.
  const columnWidth = Math.min(28, Math.max(band * 0.72, 2));
  const labelEvery = Math.max(
    1,
    Math.ceil(buckets.length / Math.max(1, Math.floor(plotWidth / 72))),
  );

  const pick = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.floor((event.clientX - box.left) / band);
    setActive(Math.min(Math.max(i, 0), buckets.length - 1));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      event.preventDefault();
      setActive((i) =>
        Math.min(Math.max((i ?? (step > 0 ? -1 : buckets.length)) + step, 0), buckets.length - 1),
      );
    } else if (event.key === "Enter" && active !== null && onSelect) {
      const t = buckets[active];
      if (t !== undefined) onSelect(t);
    }
  };

  const activeT = active === null ? undefined : buckets[active];
  const activeValues = active === null ? undefined : values[active];

  return (
    <div className="space-y-2">
      {series.length > 1 && <Legend series={series} kind={kind} />}
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={MARGIN.top + PLOT_HEIGHT + MARGIN.bottom}
            role="img"
            aria-label={label}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys step the tooltip through buckets (the table view is the full equivalent)
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="overflow-visible outline-none rounded-sm"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-ink-3 text-[10px] tabular-nums"
                >
                  {format(tick)}
                </text>
              </g>
            ))}
            {buckets.map((t, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={t}
                  x={xCenter(i)}
                  y={MARGIN.top + PLOT_HEIGHT + 16}
                  textAnchor="middle"
                  className="fill-ink-3 text-[10px] tabular-nums"
                >
                  {dayjs(t).format(tickFormats[data.bucket])}
                </text>
              ) : null,
            )}

            {kind === "stacked" &&
              buckets.map((t, i) => {
                let base = y(0);
                const segments = series.flatMap((s) => {
                  const v = values[i]?.get(s.key) ?? 0;
                  if (v <= 0) return [];
                  const h = (v / top) * PLOT_HEIGHT;
                  const segment = { key: s.key, color: s.color, y: base - h, h };
                  base -= h;
                  return [segment];
                });
                const x = xCenter(i) - columnWidth / 2;
                return (
                  <g key={t} opacity={active === null || active === i ? 1 : 0.55}>
                    {segments.map((seg, j) => {
                      // The surface gap: every segment above the first gives up its bottom 2px.
                      const h = Math.max(seg.h - (j > 0 ? GAP : 0), 0.5);
                      return j === segments.length - 1 ? (
                        <path
                          key={seg.key}
                          d={columnPath(x, seg.y, columnWidth, h)}
                          fill={seg.color}
                        />
                      ) : (
                        <rect
                          key={seg.key}
                          x={x}
                          y={seg.y}
                          width={columnWidth}
                          height={h}
                          fill={seg.color}
                        />
                      );
                    })}
                  </g>
                );
              })}

            {kind === "line" &&
              series.map((s) => {
                const path = buckets
                  .map((_, i) => {
                    const v = values[i]?.get(s.key);
                    if (v === null || v === undefined) return null;
                    const prev = i > 0 ? values[i - 1]?.get(s.key) : null;
                    return `${prev === null || prev === undefined ? "M" : "L"}${xCenter(i)},${y(v)}`;
                  })
                  .filter((part) => part !== null)
                  .join("");
                const lastIndex = values.findLastIndex((row) => row.get(s.key) != null);
                const last = values[lastIndex]?.get(s.key);
                return (
                  <g key={s.key}>
                    <path
                      d={path}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {last != null && (
                      <circle
                        cx={xCenter(lastIndex)}
                        cy={y(last)}
                        r={4}
                        fill={s.color}
                        stroke="var(--card)"
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              })}

            {active !== null && kind === "line" && (
              <line
                x1={xCenter(active)}
                x2={xCenter(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_HEIGHT}
                stroke="var(--chart-axis)"
                strokeWidth={1}
              />
            )}
            {active !== null &&
              kind === "line" &&
              series.map((s) => {
                const v = activeValues?.get(s.key);
                return v == null ? null : (
                  <circle
                    key={s.key}
                    cx={xCenter(active)}
                    cy={y(v)}
                    r={4}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                );
              })}

            {/* The hover layer; keyboard users get the same through the svg's arrow keys. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only hit area */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotWidth}
              height={PLOT_HEIGHT}
              fill="transparent"
              className={onSelect ? "cursor-pointer" : undefined}
              onPointerMove={pick}
              onPointerLeave={() => setActive(null)}
              onClick={() => {
                if (activeT !== undefined && onSelect) onSelect(activeT);
              }}
            />
          </svg>
        )}
        {activeT !== undefined && activeValues && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-[10px] bg-popover px-3 py-2 text-xs text-popover-foreground shadow-float"
            style={
              active !== null && xCenter(active) > width / 2
                ? { right: width - xCenter(active) + 12 }
                : { left: xCenter(active ?? 0) + 12 }
            }
          >
            <div className="mb-1 text-ink-3">{formatBucket(data.bucket, activeT)}</div>
            {[...series].reverse().map((s) => {
              const v = activeValues.get(s.key);
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold tabular-nums">{v == null ? "—" : format(v)}</span>
                  <span className="text-ink-3">{s.label}</span>
                </div>
              );
            })}
            {kind === "stacked" && series.length > 1 && active !== null && (
              <div className="mt-1 border-t border-hair pt-1 tabular-nums">
                <span className="font-semibold">{format(stackTotal(active))}</span>{" "}
                <span className="text-ink-3">total</span>
              </div>
            )}
            {onSelect && <div className="mt-1 text-ink-3">Click to open the log</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend<K extends string>({
  series,
  kind,
}: {
  series: readonly SeriesDef<K>[];
  kind: "stacked" | "line";
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={kind === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-sm"}
            style={{ background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** The table view of a time chart, and its CSV. */
export function timeTable<K extends string>(data: TimeData<K>, withTotal: boolean) {
  const series = shownSeries(data);
  const header = [
    "Time",
    ...series.map((s) => s.label),
    ...(withTotal && series.length > 1 ? ["Total"] : []),
  ];
  const rows = data.buckets.map((t, i) => {
    const cells = series.map((s) => data.values[i]?.get(s.key) ?? null);
    const total = cells.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    return [
      formatBucket(data.bucket, t),
      ...cells,
      ...(withTotal && series.length > 1 ? [total] : []),
    ];
  });
  return { header, rows };
}

function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${dayjs().format("YYYY-MM-DD")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A titled chart or table. With `table`, a toggle swaps the chart for its table; `csv` downloads
 * the same rows.
 */
export function ChartCard({
  title,
  description,
  csv,
  table,
  fetching,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  csv?: { filename: string; header: readonly string[]; rows: readonly (readonly unknown[])[] };
  table?: { header: readonly string[]; rows: readonly (readonly ReactNode[])[] };
  fetching?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={cn("space-y-3 rounded-xl bg-card p-5 shadow-card", className)}>
      <div className="flex items-start justify-between gap-2">
        <figcaption className="space-y-0.5">
          <div className="font-heading text-[17px] font-bold tracking-tight">{title}</div>
          {description && <div className="text-xs text-ink-3">{description}</div>}
        </figcaption>
        <div className="flex shrink-0 gap-1">
          {table && table.rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Show ${title} as a ${showTable ? "chart" : "table"}`}
              onClick={() => setShowTable((value) => !value)}
            >
              <TableIcon />
              {showTable ? "Chart" : "Table"}
            </Button>
          )}
          {csv && csv.rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Download ${title} as CSV`}
              onClick={() => downloadCsv(csv.filename, [csv.header, ...csv.rows])}
            >
              <DownloadSimpleIcon />
              CSV
            </Button>
          )}
        </div>
      </div>
      <div className={cn("transition-opacity", fetching && "opacity-60")}>
        {showTable && table?.rows.length ? (
          <div className="max-h-80 overflow-auto">
            <SimpleTable header={table.header} rows={table.rows} />
          </div>
        ) : (
          children
        )}
      </div>
    </figure>
  );
}

/** Plain rows; numbers right-aligned. */
export function SimpleTable({
  header,
  rows,
  empty = "Nothing in this range.",
}: {
  header: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  empty?: string;
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {header.map((cell, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
            <TableHead key={i} className={i > 0 ? "text-right" : undefined}>
              {cell}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are rebuilt from the response
          <TableRow key={r}>
            {row.map((cell, i) => (
              <TableCell
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                key={i}
                // The first column takes the slack and truncates, so ranked tables fit half cards.
                className={cn(
                  i > 0 && "text-right tabular-nums",
                  i === 0 && "w-full max-w-0 truncate",
                )}
                title={i === 0 && typeof cell === "string" ? cell : undefined}
              >
                {typeof cell === "number" ? cell.toLocaleString() : (cell ?? "—")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A value with a bar against the column's largest, for ranked tables. */
export function InlineBar({ value, max, label }: { value: number; max: number; label?: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">{label ?? value.toLocaleString()}</span>
      <span className="h-2 w-20 overflow-hidden rounded-full bg-tint">
        <span
          className="block h-full rounded-full"
          style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: slot(1) }}
        />
      </span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card px-4 py-3.5 shadow-card">
      <div className="text-[12.5px] font-semibold text-ink-3">{label}</div>
      <div className="mt-1 font-heading text-[26px] leading-tight font-extrabold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && <div className="text-xs text-ink-3">{hint}</div>}
    </div>
  );
}
