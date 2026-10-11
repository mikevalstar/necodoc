import type { AnalyticsBucket, AnalyticsRange } from "@necodoc/shared";
import { z } from "zod";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { dayjs } from "@/lib/date";

// Spec: docs/features/analytics-dashboards.md. The date range every dashboard shares: a preset
// or custom whole local days, kept in the URL.

const presets = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom",
} as const;
type Preset = keyof typeof presets;
const presetSchema = z.enum(Object.keys(presets) as [Preset, ...Preset[]]);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `.extend()` a page's search schema with this. */
export const rangeSearchFields = {
  range: presetSchema.default("30d"),
  /** Inclusive local days, for a custom range. */
  from: day.optional(),
  to: day.optional(),
};
export type RangeSearch = { range: Preset; from?: string; to?: string };

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The API range. Presets end at the next whole hour (24h) or day, so the query key and the
 * buckets stay stable while the page is open.
 */
export function toRange({ range, from, to }: RangeSearch): AnalyticsRange {
  if (range === "custom" && from && to) {
    return {
      from: dayjs(from).startOf("day").toISOString(),
      to: dayjs(to).add(1, "day").startOf("day").toISOString(),
      tz: timeZone,
    };
  }
  if (range === "24h") {
    const end = dayjs().startOf("hour").add(1, "hour");
    return { from: end.subtract(24, "hour").toISOString(), to: end.toISOString(), tz: timeZone };
  }
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const end = dayjs().startOf("day").add(1, "day");
  return { from: end.subtract(days, "day").toISOString(), to: end.toISOString(), tz: timeZone };
}

/** Inclusive local days covering [from, to), as the generation and audit logs filter. */
export function logDays(from: string | number, to: string | number) {
  return {
    from: dayjs(from).format("YYYY-MM-DD"),
    to: dayjs(to).subtract(1, "millisecond").format("YYYY-MM-DD"),
  };
}

/** The log days for one bucket starting at `t`. */
export const bucketDays = (bucket: AnalyticsBucket, t: number) =>
  logDays(t, dayjs(t).add(1, bucket).valueOf());

export function RangeControls({
  search,
  onChange,
}: {
  search: RangeSearch;
  onChange: (next: RangeSearch) => void;
}) {
  const custom = search.range === "custom";
  const current = logDays(toRange(search).from, toRange(search).to);
  return (
    <>
      <Field className="w-auto">
        <FieldLabel htmlFor="range">Date range</FieldLabel>
        <NativeSelect
          id="range"
          value={search.range}
          onChange={(e) => {
            const range = presetSchema.parse(e.target.value);
            // Switching to custom starts from the range on screen.
            onChange(range === "custom" ? { range, ...current } : { range });
          }}
        >
          {presetSchema.options.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {presets[value]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {custom && (
        <>
          <Field className="w-auto">
            <FieldLabel htmlFor="range-from">From</FieldLabel>
            <Input
              id="range-from"
              type="date"
              value={search.from ?? ""}
              max={search.to}
              onChange={(e) => onChange({ ...search, from: e.target.value || current.from })}
            />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="range-to">To</FieldLabel>
            <Input
              id="range-to"
              type="date"
              value={search.to ?? ""}
              min={search.from}
              onChange={(e) => onChange({ ...search, to: e.target.value || current.to })}
            />
          </Field>
        </>
      )}
    </>
  );
}
