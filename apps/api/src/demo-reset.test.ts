import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { demoResetting, nextResetAt, resetFlagPath } from "./demo-reset";

const TORONTO = "America/Toronto";
const next = (now: string, time = "00:00", zone = TORONTO) =>
  nextResetAt(new Date(now), time, zone).toISOString();
const hours = (from: string, to: string) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;

describe("nextResetAt", () => {
  it("is the coming Toronto midnight, in EST and in EDT", () => {
    expect(next("2026-01-15T17:00:00Z")).toBe("2026-01-16T05:00:00.000Z");
    expect(next("2026-07-15T17:00:00Z")).toBe("2026-07-16T04:00:00.000Z");
  });

  it("moves to the next day at and just after midnight", () => {
    expect(next("2026-01-16T05:00:00Z")).toBe("2026-01-17T05:00:00.000Z");
    expect(next("2026-01-16T04:59:59Z")).toBe("2026-01-16T05:00:00.000Z");
  });

  it("rolls over months and years", () => {
    expect(next("2026-12-31T20:00:00Z")).toBe("2027-01-01T05:00:00.000Z");
    expect(next("2026-02-28T20:00:00Z")).toBe("2026-03-01T05:00:00.000Z");
  });

  it("spans 23 hours into the spring change and 25 out of the fall one", () => {
    // 2026: clocks go forward Sunday 8 March, back Sunday 1 November, at 02:00.
    expect(next("2026-03-08T05:00:00Z")).toBe("2026-03-09T04:00:00.000Z");
    expect(hours("2026-03-08T05:00:00Z", next("2026-03-08T05:00:00Z"))).toBe(23);
    expect(next("2026-11-01T04:00:00Z")).toBe("2026-11-02T05:00:00.000Z");
    expect(hours("2026-11-01T04:00:00Z", next("2026-11-01T04:00:00Z"))).toBe(25);
  });

  it("counts right in the hours either side of a change", () => {
    // 01:59 EST on 8 March, and 01:30 EDT (the first one) on 1 November.
    expect(next("2026-03-08T06:59:00Z")).toBe("2026-03-09T04:00:00.000Z");
    expect(next("2026-11-01T05:30:00Z")).toBe("2026-11-02T05:00:00.000Z");
  });

  it("runs a time the spring change skips at the same clock time after it", () => {
    // 02:30 doesn't exist on 8 March; 03:30 EDT does.
    expect(next("2026-03-08T05:00:00Z", "02:30")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("runs a time the fall change repeats the first time", () => {
    // 01:30 happens twice on 1 November: EDT (05:30Z), then EST (06:30Z).
    expect(next("2026-11-01T04:00:00Z", "01:30")).toBe("2026-11-01T05:30:00.000Z");
    expect(next("2026-11-01T05:30:00Z", "01:30")).toBe("2026-11-02T06:30:00.000Z");
  });

  it("follows other zones and times", () => {
    expect(next("2026-06-01T12:00:00Z", "03:15", "UTC")).toBe("2026-06-02T03:15:00.000Z");
    expect(next("2026-06-01T12:00:00Z", "23:30", "Asia/Kolkata")).toBe("2026-06-01T18:00:00.000Z");
  });
});

describe("demoResetting", () => {
  afterEach(() => rmSync(resetFlagPath, { force: true }));
  // Each check is two seconds after the last one, past the cache.
  let clock = Date.now() + 10_000_000;
  const check = () => {
    clock += 2000;
    return demoResetting(clock);
  };

  it("follows the flag file", () => {
    expect(check()).toBe(false);
    writeFileSync(resetFlagPath, "");
    utimesSync(resetFlagPath, new Date(clock), new Date(clock));
    expect(check()).toBe(true);
    rmSync(resetFlagPath);
    expect(check()).toBe(false);
  });

  it("ignores a flag a killed reset left behind", () => {
    writeFileSync(resetFlagPath, "");
    const old = new Date(clock - 31 * 60_000);
    utimesSync(resetFlagPath, old, old);
    expect(check()).toBe(false);
  });
});
