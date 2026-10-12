import type { SystemStatus } from "@necodoc/shared";

// Spec: docs/features/app-shell-and-navigation.md (ops status bar). What the bar shows, from
// GET /api/system?window=1h. Pure, so the thresholds are tested (ops-status.test.ts).

export type Tone = "ok" | "warn" | "bad";

type Input = Pick<SystemStatus, "workers" | "queue" | "metrics" | "version">;

export type OpsSummary = {
  queue: { waiting: number; running: number; tone: Tone };
  /** Rendering processes (worker or all) online, and their busy and total job slots. */
  workers: { online: number; busy: number; slots: number; tone: Tone };
  p95Ms: number | null;
  p95Tone: Tone;
  errorRate: number | null;
  errorTone: Tone;
  version: string;
  /** Online processes report other versions than this API (mid-deploy). */
  mixedVersions: boolean;
};

/** A p95 above this reads as slow. */
const SLOW_P95_MS = 5000;

export function summarize(data: Input): OpsSummary {
  const online = data.workers.filter((w) => w.online);
  const renderers = online.filter((w) => w.role !== "api");
  const slots = renderers.reduce((sum, w) => sum + w.concurrency, 0);
  const busy = renderers.reduce((sum, w) => sum + w.running, 0);
  const { interactive, batch } = data.queue;
  const waiting = interactive.queued + batch.queued;
  const { errorRate } = data.metrics;
  const p95Ms = data.metrics.totalMs.p95;
  return {
    // A backlog bigger than every slot at once means jobs wait at least a full render.
    queue: {
      waiting,
      running: interactive.running + batch.running,
      tone: waiting > 0 && renderers.length === 0 ? "bad" : waiting > slots ? "warn" : "ok",
    },
    workers: { online: renderers.length, busy, slots, tone: renderers.length ? "ok" : "bad" },
    p95Ms,
    p95Tone: p95Ms !== null && p95Ms > SLOW_P95_MS ? "warn" : "ok",
    errorRate,
    errorTone: errorRate === null || errorRate <= 0.01 ? "ok" : errorRate <= 0.05 ? "warn" : "bad",
    version: data.version,
    mixedVersions: online.some((w) => w.version !== data.version),
  };
}

export const formatRate = (rate: number | null) =>
  rate === null ? "—" : rate === 0 ? "0%" : rate < 0.001 ? "<0.1%" : `${(rate * 100).toFixed(1)}%`;
