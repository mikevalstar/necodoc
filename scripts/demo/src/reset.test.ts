import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ResetSteps, runReset } from "./reset.ts";

/** Steps that record their order; `fail` names the ones that throw. */
function steps(fail: Partial<Record<keyof ResetSteps, string>> = {}, missing: string[] = []) {
  const calls: string[] = [];
  const step =
    <K extends keyof ResetSteps>(name: K, result?: unknown) =>
    () => {
      calls.push(name);
      if (fail[name]) throw new Error(fail[name]);
      return result;
    };
  const async =
    <K extends keyof ResetSteps>(name: K, result?: unknown) =>
    async () =>
      step(name, result)();
  const s = {
    raiseFlag: step("raiseFlag"),
    lowerFlag: step("lowerFlag"),
    pause: async("pause"),
    resume: async("resume"),
    clearStorage: async("clearStorage"),
    seed: async("seed"),
    missing: async("missing", missing),
    fallback: async("fallback"),
  } as ResetSteps;
  return { s, calls };
}

describe("runReset", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("flags, pauses, clears, seeds, checks, resumes, then lowers the flag", async () => {
    const { s, calls } = steps();
    expect(await runReset(s)).toBe(true);
    expect(calls).toEqual([
      "raiseFlag",
      "pause",
      "clearStorage",
      "seed",
      "missing",
      "resume",
      "lowerFlag",
    ]);
  });

  it("falls back to an empty database when the seed fails, and still resumes", async () => {
    const { s, calls } = steps({ seed: "worker exited" });
    expect(await runReset(s)).toBe(false);
    expect(calls).toEqual([
      "raiseFlag",
      "pause",
      "clearStorage",
      "seed",
      "fallback",
      "resume",
      "lowerFlag",
    ]);
  });

  it("resumes and lowers the flag when the fallback fails too", async () => {
    const { s, calls } = steps({ seed: "boom", fallback: "no database" });
    expect(await runReset(s)).toBe(false);
    expect(calls.slice(-2)).toEqual(["resume", "lowerFlag"]);
  });

  it("doesn't touch the database when pausing fails", async () => {
    const { s, calls } = steps({ pause: "pm2 not found" });
    expect(await runReset(s)).toBe(false);
    expect(calls).toEqual(["raiseFlag", "pause", "resume", "lowerFlag"]);
  });

  it("keeps the seeded data but fails when a bond template is missing", async () => {
    const { s, calls } = steps({}, ["Oregon Contractor License Bond"]);
    expect(await runReset(s)).toBe(false);
    expect(calls).not.toContain("fallback");
  });

  it("lowers the flag even when resuming fails", async () => {
    const { s, calls } = steps({ resume: "pm2 restart failed" });
    expect(await runReset(s)).toBe(false);
    expect(calls.at(-1)).toBe("lowerFlag");
  });
});
