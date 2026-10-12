import type postgres from "postgres";

// Spec: docs/features/demo-data-and-screenshots.md (How the history is made). The seed acts
// through the API in real time, then moves what each step wrote back to that step's day in the
// story. Timestamps are shifted, never invented, so ordering and gaps inside a step stay real.

type Sql = postgres.Sql;

export const TIME_ZONE = "America/Toronto";
const DAY = 86_400_000;

/** Tables whose clocks are live state, not history. */
const SKIP_TABLES = new Set(["session", "verification", "worker"]);
/** Better Auth's own expiry and rate-limit clocks for a key; the policy row holds the real ones. */
const SKIP_COLUMNS = new Set(["apikey.expires_at", "apikey.last_refill_at", "apikey.last_request"]);
/** Timestamps the API copies into audit entries' before/after JSON. */
const JSON_TIMES = ["createdAt", "updatedAt", "publishedAt", "submittedAt", "decidedAt"];

export class Clock {
  #columns: Map<string, string[]> | undefined;

  /** `now` is the story's present: when the seed started. */
  constructor(
    readonly sql: Sql,
    readonly now: Date,
  ) {}

  /** Wall-clock time in Toronto, `daysAgo` days before now. */
  day(daysAgo: number, hhmm: string): Date {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    const calendar = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(this.now.getTime() - daysAgo * DAY));
    for (const offset of [4, 5]) {
      const guess = new Date(`${calendar}T00:00:00Z`);
      guess.setUTCHours(h + offset, m);
      const hour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: TIME_ZONE,
          hour: "numeric",
          hourCycle: "h23",
        }).format(guess),
      );
      if (hour === h) return guess;
    }
    throw new Error(`No ${hhmm} on ${calendar} in ${TIME_ZONE}`);
  }

  /** `minutes` before now. */
  ago(minutes: number) {
    return new Date(this.now.getTime() - minutes * 60_000);
  }

  /** Runs `act` now, then moves everything it wrote to `when`. */
  async at<T>(when: Date, act: () => Promise<T>): Promise<T> {
    if (when > this.now) throw new Error(`Step at ${when.toISOString()} is after now`);
    const [{ since }] = (await this
      .sql`select clock_timestamp() - interval '50 milliseconds' as since`) as [{ since: Date }];
    const earlier = await this.#future(since);
    const result = await act();
    await this.shift(since, when, earlier);
    return result;
  }

  /**
   * Timestamps already in the future before a step: expiries set by earlier steps. They were
   * moved with their own step and must not move again.
   */
  async #future(since: Date) {
    const columns = await this.#timestampColumns();
    const selects = [...columns].flatMap(([table, cols]) =>
      cols.map(
        (c) => `select '${table}.${c}' as k, "${c}" as v from "${table}" where "${c}" >= $1`,
      ),
    );
    const rows = await this.sql.unsafe<{ k: string; v: Date }[]>(selects.join(" union all "), [
      since,
    ]);
    const future = new Map<string, string[]>();
    for (const { k, v } of rows) future.set(k, [...(future.get(k) ?? []), v.toISOString()]);
    return future;
  }

  /** Runs `act` with the audit log's append-only trigger lifted (the demo's own history only). */
  async unlockedAudit(act: (tx: postgres.TransactionSql) => Promise<void>) {
    await this.sql.begin(async (tx) => {
      await tx`alter table audit_event disable trigger audit_event_append_only`;
      await act(tx);
      await tx`alter table audit_event enable trigger audit_event_append_only`;
    });
  }

  async #timestampColumns() {
    if (this.#columns) return this.#columns;
    const rows = await this.sql<{ table: string; column: string }[]>`
      select table_name as table, column_name as column from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp with time zone'`;
    const columns = new Map<string, string[]>();
    for (const { table, column } of rows) {
      if (SKIP_TABLES.has(table) || SKIP_COLUMNS.has(`${table}.${column}`)) continue;
      columns.set(table, [...(columns.get(table) ?? []), column]);
    }
    this.#columns = columns;
    return columns;
  }

  /** Every timestamp at or after `since` moves back by `since - to`, except `keep`'s. */
  async shift(since: Date, to: Date, keep = new Map<string, string[]>()) {
    const ms = since.getTime() - to.getTime();
    if (ms <= 0) return;
    const columns = await this.#timestampColumns();
    await this.sql.begin(async (tx) => {
      // ADR 0032's append-only trigger, lifted for the demo's own story only.
      await tx`alter table audit_event disable trigger audit_event_append_only`;
      const audits = await tx<{ id: string; before: Json; after: Json }[]>`
        select id, before, after from audit_event where created_at >= ${since}`;
      for (const [table, cols] of columns) {
        const params: (Date | number | string[])[] = [since, ms];
        const moves = cols.map((c) => {
          params.push(keep.get(`${table}.${c}`) ?? []);
          return `("${c}" >= $1 and not ("${c}" = any($${params.length}::timestamptz[])))`;
        });
        const set = cols
          .map(
            (c, i) =>
              `"${c}" = case when ${moves[i]} then "${c}" - $2 * interval '1 millisecond' else "${c}" end`,
          )
          .join(", ");
        await tx.unsafe(`update "${table}" set ${set} where ${moves.join(" or ")}`, params);
      }
      for (const audit of audits) {
        const before = shiftJson(audit.before, since, ms);
        const after = shiftJson(audit.after, since, ms);
        if (before !== audit.before || after !== audit.after) {
          await tx`
            update audit_event set before = ${before === null ? null : tx.json(before)},
              after = ${after === null ? null : tx.json(after)}
            where id = ${audit.id}`;
        }
      }
      await tx`alter table audit_event enable trigger audit_event_append_only`;
    });
  }
}

type Json = postgres.JSONValue;

function shiftJson(value: Json, since: Date, ms: number): Json {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    return value;
  }
  let changed = false;
  const out: Record<string, Json> = { ...(value as Record<string, Json>) };
  for (const key of JSON_TIMES) {
    const time = out[key];
    if (typeof time === "string" && Date.parse(time) >= since.getTime()) {
      out[key] = new Date(Date.parse(time) - ms).toISOString();
      changed = true;
    }
  }
  return changed ? out : value;
}
