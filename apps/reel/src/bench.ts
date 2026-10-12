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

export const count = (v: number) => Math.round(v).toLocaleString("en-CA");

/** Batch runs, fewest workers first. */
export const runs: Throughput[] = [...bench.throughput].sort((a, b) => a.workers - b.workers);
function run(index: number) {
  const found = runs.at(index);
  if (!found) throw new Error("latest.json has no batch throughput runs");
  return found;
}
export const fastest = run(-1);
export const slowest = run(0);

export const workers = (n: number) => `${n} worker${n === 1 ? "" : "s"}`;
