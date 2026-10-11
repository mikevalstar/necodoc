import { describe, expect, it } from "vitest";
import { tokenBucket } from "./rate-limit";

describe("tokenBucket", () => {
  it("allows a burst up to capacity, then refuses until a token refills", () => {
    const bucket = tokenBucket({ capacity: 2, refillMs: 1000 });
    expect(bucket.take("a", 0).ok).toBe(true);
    expect(bucket.take("a", 0).ok).toBe(true);
    expect(bucket.take("a", 400)).toEqual({ ok: false, retryAfterMs: 600 });
    expect(bucket.take("a", 1000).ok).toBe(true);
    expect(bucket.take("a", 1500).ok).toBe(false);
  });

  it("keeps keys apart", () => {
    const bucket = tokenBucket({ capacity: 1, refillMs: 1000 });
    expect(bucket.take("a", 0).ok).toBe(true);
    expect(bucket.take("b", 0).ok).toBe(true);
    expect(bucket.take("a", 0).ok).toBe(false);
  });

  it("refills to capacity at most", () => {
    const bucket = tokenBucket({ capacity: 2, refillMs: 1000 });
    bucket.take("a", 0);
    for (const ok of [true, true, false]) expect(bucket.take("a", 60_000).ok).toBe(ok);
  });
});
