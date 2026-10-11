import { describe, expect, it } from "vitest";
import { limiter } from "./limiter";

describe("limiter", () => {
  it("never runs more than max at once and runs everything", async () => {
    const run = limiter(() => 2);
    let active = 0;
    let peak = 0;
    const task = (i: number) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return i;
      });
    expect(await Promise.all([0, 1, 2, 3, 4, 5].map(task))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws", async () => {
    const run = limiter(() => 1);
    await expect(run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await run(async () => "next")).toBe("next");
  });
});
