/**
 * A token bucket per key (e.g. client IP): `capacity` requests at once, refilled one every
 * `refillMs`. In this process's memory only: several API nodes each keep their own buckets, and a
 * restart forgets them (docs/features/share-links-and-data-requests.md).
 */
export function tokenBucket({ capacity, refillMs }: { capacity: number; refillMs: number }) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    /** Takes a token if there is one; otherwise says how long until the next. */
    take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
      const bucket = buckets.get(key) ?? { tokens: capacity, at: now };
      const refilled = Math.floor((now - bucket.at) / refillMs);
      const tokens = Math.min(capacity, bucket.tokens + refilled);
      // Keep the remainder of a partly refilled token; a full bucket restarts the clock.
      const at = tokens === capacity ? now : bucket.at + refilled * refillMs;
      if (tokens === 0) {
        buckets.set(key, { tokens, at });
        return { ok: false, retryAfterMs: at + refillMs - now };
      }
      buckets.set(key, { tokens: tokens - 1, at });
      // Full buckets carry no state; drop them now and then so the map doesn't grow forever.
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) {
          if (b.tokens + Math.floor((now - b.at) / refillMs) >= capacity) buckets.delete(k);
        }
      }
      return { ok: true };
    },
  };
}
