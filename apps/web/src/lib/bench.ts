// Every performance number on the site comes from the W2 benchmark output
// (docs/features/performance-benchmark.md), never typed by hand. A missing results file
// renders visible placeholders; a file that doesn't match the schema fails the build.
import { formatMs, type Latency, type Results, resultsSchema } from "@necodoc/bench/schema";

const found = import.meta.glob<{ default: unknown }>(
  "../../../../scripts/bench/results/latest.json",
  {
    eager: true,
  },
);
const raw = Object.values(found)[0]?.default;

/** The parsed run, or null when no run has been committed yet. */
export const bench: Results | null = raw === undefined ? null : resultsSchema.parse(raw);

/** A value ready to print, or the placeholder key it stands in for. */
export type BenchValue = { text: string } | { placeholder: string };

const latency = (id: string): Latency | undefined => bench?.latency.find((l) => l.id === id);

const pick = (key: string, value: string | null | undefined): BenchValue =>
  value == null ? { placeholder: `{bench.${key}}` } : { text: value };

/** Latency scenarios by id from scripts/bench/src/scenarios.ts; client round trip. */
export const roundTrip = (id: string, stat: "p50" | "p95") => {
  const v = latency(id)?.roundTrip[stat];
  return pick(`${id}.${stat}`, v == null ? null : formatMs(v));
};

/** Worker counts the site quotes throughput for. */
export const scaleWorkers = [1, 2, 4, 8] as const;

/**
 * Batch documents per minute by worker count, one worker per server. 1 is the measured run; more
 * workers follow the model in docs/features/performance-benchmark.md (each added worker gives 90%
 * of the single-worker rate), until a multi-server run replaces it. Kept apart from `bench`, which
 * holds only measured values.
 */
export const scaleModel = (() => {
  const single = bench?.throughput.find((t) => t.workers === 1)?.docsPerMinute;
  if (single === undefined) return null;
  return scaleWorkers.map((workers) => ({
    workers,
    docsPerMinute:
      workers === 1
        ? Math.round(single)
        : Math.round((single * (1 + 0.9 * (workers - 1))) / 10) * 10,
  }));
})();

/** Batch documents per minute at a worker count, from `scaleModel`. */
export const docsPerMinute = (workers: (typeof scaleWorkers)[number]) => {
  const point = scaleModel?.find((p) => p.workers === workers);
  return pick(`scaleModel.${workers}`, point?.docsPerMinute.toLocaleString("en-CA"));
};

export const env = {
  cpu: pick("env.cpu", bench?.environment.cpu),
  cores: pick("env.cores", bench?.environment.cores.toString()),
  memory: pick("env.memoryGb", bench ? `${bench.environment.memoryGb} GB` : null),
  sha: pick("env.gitSha", bench?.environment.gitSha.slice(0, 7)),
  date: pick("finishedAt", bench?.finishedAt.slice(0, 10)),
  batchRows: pick("settings.batchRows", bench?.settings.batchRows.toLocaleString("en-CA")),
  concurrency: pick("settings.concurrency", bench?.settings.concurrency.toString()),
  samples: pick("settings.samples", bench?.settings.samples.toString()),
};

/**
 * Why this run shouldn't be quoted yet, if it shouldn't. The spec allows publishing only a
 * full run, so quick or dirty-tree runs are flagged next to the numbers.
 */
export const caveat: string | null = !bench
  ? "No benchmark run yet: values are placeholders."
  : bench.quick
    ? "Quick smoke run: not for publishing."
    : bench.environment.gitDirty
      ? "Run on an uncommitted tree: rerun from a clean commit before publishing."
      : null;
