import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Latency, resultsSchema } from "@necodoc/bench/schema";
import { root } from "@necodoc/bench/stack";
import type { GenerationSource } from "@necodoc/shared";
import type postgres from "postgres";
import type { Clock } from "./clock.ts";
import type { DocumentKind, Rand } from "./fake.ts";
import type { PersonKey } from "./people.ts";

// Spec: docs/features/demo-data-and-screenshots.md (How the history is made). Plans 90 days of
// generations; the seed renders the last 14 through the worker and inserts the rest here, as
// retention would have left them, with render times drawn from the benchmark results.

type Sql = postgres.Sql;

export const RENDERED_DAYS = 14;
export const INPUT_DAYS = 30;
const DAYS = 90;

export type KeyName = "policyAdmin" | "brokerPortal" | "renewals" | "claims";

export type Job = {
  /** Sent as X-Request-Id; how the seed finds the generation again. */
  requestId: string;
  at: Date;
  kind: DocumentKind;
  source: Extract<GenerationSource, "api" | "app" | "share_link">;
  key?: KeyName;
  person?: PersonKey;
  /** Inserted as a failure instead of rendered. */
  fail?: { error: string; attempts: number; totalMs: number };
};

/** Who makes what, and how often (weights over a working day). */
const mix: readonly (readonly [Omit<Job, "requestId" | "at">, number])[] = [
  [{ kind: "declarations", source: "api", key: "policyAdmin" }, 30],
  [{ kind: "certificate", source: "api", key: "brokerPortal" }, 15],
  [{ kind: "certificate", source: "app", person: "hannah" }, 3],
  [{ kind: "certificate", source: "app", person: "aisha" }, 2],
  [{ kind: "statement", source: "api", key: "policyAdmin" }, 10],
  [{ kind: "claims", source: "api", key: "claims" }, 10],
  [{ kind: "oregonBond", source: "app", person: "tom" }, 4],
  [{ kind: "oregonBond", source: "app", person: "hannah" }, 2],
  [{ kind: "oregonBond", source: "share_link" }, 4],
  [{ kind: "ontarioCertificate", source: "app", person: "tom" }, 3],
  [{ kind: "ontarioCertificate", source: "app", person: "luc" }, 2],
  [{ kind: "ontarioCertificate", source: "api", key: "policyAdmin" }, 3],
  [{ kind: "orCcb", source: "app", person: "tom" }, 3],
  [{ kind: "orCcb", source: "share_link" }, 3],
  [{ kind: "castlePines", source: "app", person: "hannah" }, 2],
  [{ kind: "renewal", source: "api", key: "renewals" }, 3],
];

/** Toronto working hours, busiest mid-morning and mid-afternoon. */
const hours: readonly (readonly [number, number])[] = [
  [7, 2],
  [8, 6],
  [9, 10],
  [10, 12],
  [11, 11],
  [12, 7],
  [13, 9],
  [14, 12],
  [15, 11],
  [16, 8],
  [17, 4],
  [18, 2],
  [19, 1],
  [21, 1],
  [23, 1],
];

const failures = [
  { error: "Render timed out", attempts: 1, totalMs: 30_000 },
  { error: "Target page, context or browser has been closed", attempts: 3, totalMs: 4_100 },
  { error: "write CONNECT_TIMEOUT 10.60.2.40:5432", attempts: 3, totalMs: 31_200 },
] as const;

/** Share links exist from this many days ago (the seed creates them then). */
export const SHARE_LINK_DAYS = 16;

/** Every individual generation over 90 days, oldest first. About 0.5% are failures. */
export function plan(clock: Clock, r: Rand, firstAvailable: (kind: DocumentKind) => Date | null) {
  const jobs: Job[] = [];
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const noon = clock.day(daysAgo, "12:00");
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      weekday: "short",
    }).format(noon);
    const weekend = weekday === "Sat" || weekday === "Sun";
    const count = Math.round((weekend ? 6 : 46) * (0.8 + r.next() * 0.4));
    for (let i = 0; i < count; i++) {
      const pick = r.weighted(mix);
      const any = weekend ? r.int(9, 16) : r.weighted(hours);
      // Integrations run late too; people stop around six.
      const hour = pick.source === "api" || any <= 18 ? any : r.int(9, 16);
      const at = clock.day(daysAgo, `${hour}:${String(r.int(0, 59)).padStart(2, "0")}`);
      at.setUTCSeconds(r.int(0, 59), r.int(0, 999));
      if (at > clock.now) continue;
      // Integrations run around the clock; people fill documents on weekdays.
      if (weekend && pick.source !== "api") continue;
      if (pick.source === "share_link" && daysAgo > SHARE_LINK_DAYS) continue;
      const available = firstAvailable(pick.kind);
      if (!available || available > at) continue;
      jobs.push({ requestId: randomUUID(), at, ...pick });
    }
  }
  jobs.sort((a, b) => a.at.getTime() - b.at.getTime());
  const failing = Math.round(jobs.length * 0.005);
  for (let i = 0; i < failing; i++) {
    const job = jobs[r.int(0, jobs.length - 1)];
    if (job && !job.fail) job.fail = { ...r.pick(failures) };
  }
  return jobs;
}

// ---------------------------------------------------------------------------------------------
// Render times from the benchmark

const bench = resultsSchema.parse(
  JSON.parse(readFileSync(join(root, "scripts/bench/results/latest.json"), "utf8")),
);
const scenario = (id: string): Latency => {
  const found = bench.latency.find((l) => l.id === id);
  if (!found) throw new Error(`The benchmark results have no ${id} scenario`);
  return found;
};

/** Which benchmark scenario each document renders like. */
const scenarioOf: Record<DocumentKind, string> = {
  declarations: "html-invoice",
  certificate: "html-invoice",
  claims: "html-invoice",
  renewal: "template-bond",
  oregonBond: "template-bond",
  ontarioCertificate: "html-invoice",
  orCcb: "overlay-acroform",
  castlePines: "overlay-flat",
  statement: "html-simple",
};

/**
 * One render's queue wait and run time: the benchmark's distribution on an idle laptop, with
 * production's contention on top (busier at peak hours, and a rare slow outlier).
 */
export function sampleTimes(r: Rand, kind: DocumentKind, at: Date) {
  const s = scenario(scenarioOf[kind]);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Toronto",
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
  const busy = hour >= 9 && hour <= 16 ? 1.6 : 1;
  const p50 = s.run.p50 ?? 80;
  const p95 = s.run.p95 ?? p50 * 1.2;
  let durationMs = Math.round(r.logNormal(p50 * 1.15, p95 * 1.9) * (r.chance(0.3) ? busy : 1));
  if (r.chance(0.008)) durationMs *= r.int(3, 9);
  const queueWaitMs = Math.round(r.logNormal(4 * busy, 45 * busy));
  const share = (part: number) => {
    const total = Object.values(s.breakdown).reduce((a, b) => a + b, 0) || 1;
    return Math.round((part / total) * durationMs);
  };
  return {
    durationMs,
    queueWaitMs,
    timings: {
      liquidMs: share(s.breakdown.liquidMs),
      chromiumMs: share(s.breakdown.chromiumMs),
      bandsMs: share(s.breakdown.bandsMs),
      stampMs: share(s.breakdown.stampMs),
      finishMs: 0,
    },
  };
}

/** Batch rows run back to back on the workers' slots: their queue waits pile up. */
export function sampleBatchTimes(r: Rand, rows: number, start: Date, slots = 4) {
  const free = Array.from({ length: slots }, () => start.getTime());
  return Array.from({ length: rows }, () => {
    const slot = free.indexOf(Math.min(...free));
    const startedAt = (free[slot] ?? start.getTime()) + r.int(1, 6);
    const durationMs = Math.round(r.logNormal(205, 280));
    free[slot] = startedAt + durationMs;
    return { startedAt: new Date(startedAt), durationMs, queueWaitMs: startedAt - start.getTime() };
  });
}

// ---------------------------------------------------------------------------------------------
// Inserting history

export type Version = { id: string; version: number; publishedAt: Date };
export type Prototype = {
  templateId: string | null;
  input: Record<string, unknown> | null;
  signing: postgres.JSONValue | null;
  size: number;
  pageCount: number;
};

/** The version a document made at `at` would have used: the newest published by then. */
export function versionAt(versions: readonly Version[], at: Date) {
  return [...versions].reverse().find((v) => v.publishedAt <= at) ?? null;
}

export type Row = {
  id: string;
  source: GenerationSource;
  status: "success" | "error";
  userId: string | null;
  apiKeyId: string | null;
  templateId: string | null;
  templateVersionId: string | null;
  batchId: string | null;
  batchRow: number | null;
  requestId: string;
  filename: string;
  error: string | null;
  input: Record<string, unknown> | null;
  subject: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date;
  durationMs: number | null;
  queueWaitMs: number | null;
  totalMs: number;
  timings: Record<string, number> | null;
  signing: postgres.JSONValue | null;
  attempts: number;
  workerId: string | null;
  pageCount: number | null;
  size: number | null;
};

export async function insertGenerations(sql: Sql, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((row) => ({
      id: row.id,
      source: row.source,
      status: row.status,
      user_id: row.userId,
      api_key_id: row.apiKeyId,
      template_id: row.templateId,
      template_version_id: row.templateVersionId,
      batch_id: row.batchId,
      batch_row: row.batchRow,
      request_id: row.requestId,
      filename: row.filename,
      error: row.error,
      warnings: sql.json([]),
      input: row.input === null ? null : sql.json(row.input as postgres.JSONValue),
      subject: row.subject,
      queued_at: row.queuedAt,
      started_at: row.startedAt,
      finished_at: row.finishedAt,
      duration_ms: row.durationMs,
      queue_wait_ms: row.queueWaitMs,
      total_ms: row.totalMs,
      timings: row.timings === null ? null : sql.json(row.timings),
      signing: row.signing === null ? null : sql.json(row.signing),
      attempts: row.attempts,
      worker_id: row.workerId,
      page_count: row.pageCount,
      size: row.size,
    }));
    await sql`insert into generation ${sql(chunk)}`;
  }
}

/** A planned job as the log would hold it after retention. */
export function historyRow(
  r: Rand,
  job: Job,
  ctx: {
    now: Date;
    proto: Prototype;
    version: Version | null;
    userId: string | null;
    apiKeyId: string | null;
    workers: readonly string[];
    data: { data?: Record<string, unknown>; subject: string; filename?: string };
    filename: string;
  },
): Row {
  const age = (ctx.now.getTime() - job.at.getTime()) / 86_400_000;
  const times = sampleTimes(r, job.kind, job.at);
  const failed = job.fail;
  const startedAt = new Date(job.at.getTime() + times.queueWaitMs);
  const durationMs = failed ? Math.max(0, failed.totalMs - times.queueWaitMs) : times.durationMs;
  const finishedAt = new Date(startedAt.getTime() + durationMs);
  const keepInput = age <= INPUT_DAYS && ctx.proto.input !== null;
  return {
    id: randomUUID(),
    source: job.source,
    status: failed ? "error" : "success",
    userId: ctx.userId,
    apiKeyId: ctx.apiKeyId,
    templateId: ctx.proto.templateId,
    templateVersionId: ctx.version?.id ?? null,
    batchId: null,
    batchRow: null,
    requestId: job.requestId,
    filename: ctx.filename,
    error: failed?.error ?? null,
    input: keepInput
      ? {
          ...ctx.proto.input,
          ...(ctx.data.data ? { data: ctx.data.data } : {}),
          filename: ctx.filename,
        }
      : null,
    subject: ctx.data.subject,
    queuedAt: job.at,
    startedAt,
    finishedAt,
    durationMs,
    queueWaitMs: times.queueWaitMs,
    totalMs: finishedAt.getTime() - job.at.getTime(),
    timings: failed ? null : times.timings,
    signing: failed ? null : ctx.proto.signing,
    attempts: failed?.attempts ?? 1,
    workerId: r.pick(ctx.workers),
    pageCount: failed ? null : ctx.proto.pageCount,
    size: failed ? null : Math.round(ctx.proto.size * (0.9 + r.next() * 0.2)),
  };
}
