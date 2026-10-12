// Every number in the reel comes from the W2 benchmark run the site also quotes
// (docs/features/performance-benchmark.md); nothing is typed by hand.
import { resultsSchema, type Throughput } from "@necodoc/bench/schema";
import raw from "../../../scripts/bench/results/latest.json" with { type: "json" };

export const bench = resultsSchema.parse(raw);

export const latency = (id: string) => {
  const found = bench.latency.find((l) => l.id === id);
  if (!found) throw new Error(`Benchmark scenario "${id}" is missing from latest.json`);
  return found;
};

export const ms = (v: number | null): string => {
  if (v == null) return "n/a";
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
};

export const count = (v: number) => Math.round(v).toLocaleString("en-CA");

/** Batch runs, fewest workers first. */
export const runs: Throughput[] = [...bench.throughput].sort((a, b) => a.workers - b.workers);
const most = runs.at(-1);
const fewest = runs[0];
if (!most || !fewest) throw new Error("latest.json has no batch throughput runs");
export const fastest = most;
export const slowest = fewest;

export const workers = (n: number) => `${n} worker${n === 1 ? "" : "s"}`;
