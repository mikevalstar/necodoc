import type { SystemStatus } from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { formatRate, summarize } from "./ops-status";

type Worker = SystemStatus["workers"][number];
const worker = (over: Partial<Worker>): Worker => ({
  id: "h:1",
  host: "h",
  pid: 1,
  version: "1.0.0",
  role: "worker",
  concurrency: 2,
  running: 0,
  eventLoopLagMs: 0,
  startedAt: "2026-10-12T00:00:00.000Z",
  lastSeen: "2026-10-12T00:00:00.000Z",
  online: true,
  ...over,
});

const base = (over: Partial<Parameters<typeof summarize>[0]> = {}) => ({
  version: "1.0.0",
  workers: [worker({}), worker({ id: "api", role: "api", concurrency: 2 })],
  queue: { interactive: { queued: 0, running: 0 }, batch: { queued: 0, running: 0 } },
  metrics: {
    renders: 100,
    errors: 0,
    rendersPerMinute: 1,
    errorRate: 0,
    totalMs: { p50: 400, p95: 900, p99: 1200 },
    queueWaitMs: { p50: 10, p95: 20, p99: 30 },
  },
  ...over,
});

describe("summarize", () => {
  it("counts only online rendering processes as workers", () => {
    const s = summarize(
      base({
        workers: [
          worker({ running: 1, concurrency: 4 }),
          worker({ id: "all", role: "all", running: 1 }),
          worker({ id: "api", role: "api" }),
          worker({ id: "gone", online: false, concurrency: 8 }),
        ],
      }),
    );
    expect(s.workers).toEqual({ online: 2, busy: 2, slots: 6, tone: "ok" });
  });

  it("flags no workers, and a queue nobody will drain", () => {
    const s = summarize(
      base({
        workers: [worker({ role: "api" })],
        queue: { interactive: { queued: 3, running: 0 }, batch: { queued: 0, running: 0 } },
      }),
    );
    expect(s.workers.tone).toBe("bad");
    expect(s.queue.tone).toBe("bad");
  });

  it("warns when the backlog is bigger than every slot", () => {
    const queue = { interactive: { queued: 1, running: 2 }, batch: { queued: 2, running: 0 } };
    const s = summarize(base({ queue }));
    expect(s.queue).toEqual({ waiting: 3, running: 2, tone: "warn" });
  });

  it("grades failure rate and p95", () => {
    const metrics = (errorRate: number | null, p95: number | null) => ({
      ...base().metrics,
      errorRate,
      totalMs: { p50: null, p95, p99: null },
    });
    expect(summarize(base({ metrics: metrics(0.01, 5000) }))).toMatchObject({
      errorTone: "ok",
      p95Tone: "ok",
    });
    expect(summarize(base({ metrics: metrics(0.03, 5001) }))).toMatchObject({
      errorTone: "warn",
      p95Tone: "warn",
    });
    expect(summarize(base({ metrics: metrics(0.2, null) }))).toMatchObject({
      errorTone: "bad",
      p95Tone: "ok",
    });
    expect(summarize(base({ metrics: metrics(null, null) })).errorTone).toBe("ok");
  });

  it("spots processes on another version", () => {
    expect(summarize(base()).mixedVersions).toBe(false);
    expect(summarize(base({ workers: [worker({ version: "0.9.0" })] })).mixedVersions).toBe(true);
    // Offline leftovers from the last deploy don't count.
    expect(
      summarize(base({ workers: [worker({}), worker({ version: "0.9.0", online: false })] }))
        .mixedVersions,
    ).toBe(false);
  });
});

describe("formatRate", () => {
  it("formats", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.0004)).toBe("<0.1%");
    expect(formatRate(0.0123)).toBe("1.2%");
  });
});
