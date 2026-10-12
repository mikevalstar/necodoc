// Every performance number on the site comes from the W2 benchmark output
// (docs/features/performance-benchmark.md), never typed by hand. A missing results file
// renders visible placeholders; a file that doesn't match the schema fails the build.
import { type Latency, type Results, resultsSchema } from "@necodoc/bench/schema";

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

export const ms = (v: number | null | undefined): string | null => {
  if (v == null) return null;
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
};

const latency = (id: string): Latency | undefined => bench?.latency.find((l) => l.id === id);

const pick = (key: string, value: string | null | undefined): BenchValue =>
  value == null ? { placeholder: `{bench.${key}}` } : { text: value };

/** Latency scenarios by id from scripts/bench/src/scenarios.ts; client round trip. */
export const roundTrip = (id: string, stat: "p50" | "p95") =>
  pick(`${id}.${stat}`, ms(latency(id)?.roundTrip[stat]));

/** Batch documents per minute at a worker count, if that count was run. */
export const docsPerMinute = (workers: number) => {
  const run = bench?.throughput.find((t) => t.workers === workers);
  return pick(
    `scale.${workers}`,
    run ? Math.round(run.docsPerMinute).toLocaleString("en-CA") : null,
  );
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
