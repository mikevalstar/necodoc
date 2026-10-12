import type { Job } from "pg-boss";
import { systemClock } from "pg-boss/dist/clock.js";
// pg-boss's own fetch loop, so an upgrade that changes how notifyWorker skips the wait fails here.
import Worker from "pg-boss/dist/worker.js";
import { describe, expect, it } from "vitest";
import { workInSlots } from "./queue-slots";

const POLL_MS = 500;
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A queue of `jobs` numbered jobs and a stand-in for boss.work / notifyWorker over real Workers. */
function fakeBoss(jobs: number) {
  const ready = Array.from({ length: jobs }, (_, i) => i);
  const workers = new Map<string, Worker<number>>();
  let fetches = 0;
  const boss = {
    notifyWorker: (id: string) => workers.get(id)?.notify(),
    work: async (handler: (jobs: Job<number>[]) => Promise<void>) => {
      const id = `w${workers.size}`;
      const worker = new Worker({
        id,
        workId: id,
        name: "render",
        options: {},
        clock: systemClock,
        resolveInterval: () => POLL_MS,
        // A database round trip, like the real one.
        fetch: async () => {
          await tick();
          fetches++;
          const job = ready.shift();
          return job === undefined
            ? []
            : [{ id: String(job), name: "render", data: job } as Job<number>];
        },
        onFetch: async (batch: Job<number>[]) => {
          if (batch.length) await handler(batch);
        },
        onError: () => {},
      });
      workers.set(id, worker);
      worker.start();
      return id;
    },
    ready,
    fetches: () => fetches,
    stop: () => Promise.all([...workers.values()].map((w) => w.stop())),
  };
  return boss;
}

describe("workInSlots", () => {
  it("fetches the next job as soon as one finishes instead of waiting out the poll", async () => {
    const boss = fakeBoss(40);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const started = performance.now();
    await workInSlots(
      boss,
      2,
      async ([job]) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        if (job) done.push(job.data);
      },
      boss.work,
    );
    while (done.length < 40) await new Promise((resolve) => setTimeout(resolve, 5));
    // At one job per poll per slot this would take 10 s.
    expect(performance.now() - started).toBeLessThan(POLL_MS);
    expect(peak).toBe(2);
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    await boss.stop();
  });

  it("waits for the poll once the queue is empty", async () => {
    const boss = fakeBoss(3);
    await workInSlots(boss, 2, async () => {}, boss.work);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS / 2));
    // 3 jobs, then one empty fetch per slot, then nothing until the poll.
    expect(boss.ready).toEqual([]);
    expect(boss.fetches()).toBe(5);
    await boss.stop();
  });

  it("still fetches again right away after a job fails", async () => {
    const boss = fakeBoss(4);
    const attempts: number[] = [];
    await workInSlots(
      boss,
      1,
      async ([job]) => {
        if (job) attempts.push(job.data);
        throw new Error("render failed");
      },
      boss.work,
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_MS / 2));
    expect(attempts).toEqual([0, 1, 2, 3]);
    await boss.stop();
  });

  it("stopping the workers lets a running job finish and fetches nothing after", async () => {
    const boss = fakeBoss(10);
    let finished = 0;
    let release = () => {};
    await workInSlots(
      boss,
      1,
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        finished++;
      },
      boss.work,
    );
    while (boss.fetches() < 1) await tick();
    const stopping = boss.stop();
    release();
    await stopping;
    expect(finished).toBe(1);
    expect(boss.fetches()).toBe(1);
  });
});
