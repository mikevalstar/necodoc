import { describe, expect, it } from "vitest";
import { queuePauseSchema, withPaused } from "./system";

describe("withPaused", () => {
  it("adds a queue once, in a stable order", () => {
    expect(withPaused(["webhook"], "render", true)).toEqual(["render", "webhook"]);
    expect(withPaused(["render"], "render", true)).toEqual(["render"]);
  });

  it("removes only the resumed queue", () => {
    expect(withPaused(["render", "retention"], "render", false)).toEqual(["retention"]);
    expect(withPaused([], "webhook", false)).toEqual([]);
  });
});

describe("queuePauseSchema", () => {
  it("refuses queues that can't be paused", () => {
    expect(queuePauseSchema.safeParse({ queue: "render", paused: true }).success).toBe(true);
    expect(queuePauseSchema.safeParse({ queue: "render-lost", paused: true }).success).toBe(false);
  });
});
