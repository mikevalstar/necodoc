import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { apiKeyMinute } from "./db/schema";

// ADR 0048: a key's requests over the last hour, counted in minute buckets in Postgres so every
// API node shares them. The hour is the current minute and the 59 before it.

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;

/**
 * Counts one request against `limit` requests per hour. A refused request is taken back, so
 * retrying while limited doesn't push the wait out; Retry-After is when the oldest counted
 * minute leaves the hour, which frees at least one request.
 */
export async function countKeyRequest(
  keyId: string,
  limit: number,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const minute = Math.floor(now / MINUTE_MS);
  const first = minute - HOUR_MINUTES + 1;
  // One statement: bump this minute, drop the key's minutes older than the hour, and sum the
  // hour (the earlier minutes read before the bump, plus the bumped count).
  const [usage] = await db.execute<{ total: number; oldest: number | null }>(sql`
    with bumped as (
      insert into ${apiKeyMinute} (api_key_id, minute, count) values (${keyId}, ${minute}, 1)
      on conflict (api_key_id, minute) do update set count = ${apiKeyMinute.count} + 1
      returning minute, count
    ), pruned as (
      delete from ${apiKeyMinute} where api_key_id = ${keyId} and minute < ${first}
    ), hour as (
      select minute, count from bumped
      union all
      select minute, count from ${apiKeyMinute}
      where api_key_id = ${keyId} and minute >= ${first} and minute < ${minute}
    )
    select sum(count)::int as total, min(minute) filter (where count > 0) as oldest from hour
  `);
  if (!usage || usage.total <= limit) return { ok: true };
  await db
    .update(apiKeyMinute)
    .set({ count: sql`${apiKeyMinute.count} - 1` })
    .where(and(eq(apiKeyMinute.apiKeyId, keyId), eq(apiKeyMinute.minute, minute)));
  const freedAt = ((usage.oldest ?? minute) + HOUR_MINUTES) * MINUTE_MS;
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((freedAt - now) / 1000)) };
}
