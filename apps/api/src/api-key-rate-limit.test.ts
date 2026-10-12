import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const takeBack = vi.fn();
vi.mock("./db", () => ({
  db: { execute, update: () => ({ set: () => ({ where: takeBack }) }) },
}));

const { countKeyRequest } = await import("./api-key-rate-limit");

const MINUTE = 60_000;
// 30 s into minute 1000.
const now = 1000 * MINUTE + 30_000;

describe("countKeyRequest", () => {
  beforeEach(() => {
    execute.mockReset();
    takeBack.mockReset();
  });

  it("allows requests up to the hourly limit", async () => {
    execute.mockResolvedValue([{ total: 10, oldest: 950 }]);
    expect(await countKeyRequest("key", 10, now)).toEqual({ ok: true });
    expect(takeBack).not.toHaveBeenCalled();
  });

  it("refuses past the limit, takes the request back, and waits for the oldest minute to leave", async () => {
    execute.mockResolvedValue([{ total: 11, oldest: 950 }]);
    // Minute 950 leaves the hour when minute 1010 starts: 9.5 minutes from now.
    expect(await countKeyRequest("key", 10, now)).toEqual({ ok: false, retryAfterSeconds: 570 });
    expect(takeBack).toHaveBeenCalledOnce();
  });

  it("waits the whole hour when every request is in the current minute", async () => {
    execute.mockResolvedValue([{ total: 3, oldest: 1000 }]);
    expect(await countKeyRequest("key", 2, now)).toEqual({ ok: false, retryAfterSeconds: 3570 });
  });
});
