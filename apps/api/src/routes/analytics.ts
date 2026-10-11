import { zValidator } from "@hono/zod-validator";
import {
  type AnalyticsBucket,
  type AnalyticsRange,
  analyticsBucket,
  analyticsRangeSchema,
  documentAnalyticsQuerySchema,
  hasPermission,
  parseRoles,
  type Role,
  roleSchema,
  type SignInChannel,
} from "@necodoc/shared";
import {
  and,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { db } from "../db";
import {
  apiKeyPolicy,
  apikey,
  auditEvent,
  batch,
  generation,
  serviceAccount,
  shareLink,
  submission,
  template,
  user,
} from "../db/schema";
import { ssoProviders } from "../env";
import { type AppEnv, requirePermission, requireRole } from "../middleware";

// Spec: docs/features/analytics-dashboards.md. Aggregates over the generation log, the audit log,
// submissions and users at request time; no rollup tables. Series come back long-form (one row
// per bucket and key) with the full bucket list, so the app fills gaps with zeros.

type Window = { from: Date; to: Date; tz: string; bucket: AnalyticsBucket };

const toWindow = (range: AnalyticsRange): Window => {
  const from = new Date(range.from);
  const to = new Date(range.to);
  return { from, to, tz: range.tz, bucket: analyticsBucket(from, to) };
};

/**
 * The bucket a timestamp falls in, as epoch ms. The unit is a literal from a fixed list; the
 * zone is a parameter, so queries group by position (`1`) rather than repeating the expression.
 */
const bucketOf = (column: AnyPgColumn | SQL, w: Window) =>
  sql<number>`extract(epoch from date_trunc(${sql.raw(`'${w.bucket}'`)}, ${column}, ${w.tz}))::float8 * 1000`.mapWith(
    Number,
  );
/** GROUP BY / ORDER BY a select column by position. */
const col = (n: number) => sql.raw(String(n));
/** A timestamp parameter. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const inRange = (column: AnyPgColumn, w: Window) =>
  sql`${column} >= ${at(w.from)} and ${column} < ${at(w.to)}`;

/** Every bucket start in the window, so empty buckets still show. */
async function bucketList(w: Window): Promise<number[]> {
  const rows = await db.execute<{ t: number }>(
    sql`select extract(epoch from b)::float8 * 1000 as t from generate_series(
      date_trunc(${sql.raw(`'${w.bucket}'`)}, ${w.from.toISOString()}::timestamptz, ${w.tz}),
      ${w.to.toISOString()}::timestamptz - interval '1 millisecond',
      ${sql.raw(`'1 ${w.bucket}'`)}::interval,
      ${w.tz}
    ) as b`,
  );
  return rows.map((row) => Number(row.t));
}

const linkResponses = (w: Window) =>
  sql<number>`count(${submission.id}) filter (where ${inRange(submission.createdAt, w)})`.mapWith(
    Number,
  );

/** A service account's generations in the range (it has few rows; a subquery is fine). */
const accountGenerations = (w: Window) =>
  sql<number>`(select count(*) from ${generation} where ${generation.userId} = ${serviceAccount.userId} and ${inRange(generation.queuedAt, w)})`.mapWith(
    Number,
  );

const inWindow = (column: AnyPgColumn, w: Window) => and(gte(column, w.from), lt(column, w.to));

const total = sql<number>`count(*)`.mapWith(Number);
const errors = sql<number>`count(*) filter (where ${generation.status} = 'error')`.mapWith(Number);
const percentile = (p: number, column: AnyPgColumn) =>
  sql<number | null>`percentile_cont(${sql.raw(String(p))}) within group (order by ${column})`;
const sum = (column: AnyPgColumn) =>
  sql<number>`coalesce(sum(${column}), 0)::float8`.mapWith(Number);
const finished = inArray(generation.status, ["success", "error"]);

/** Generation counts and sizes, by status, for a filter. */
const generationTotals = (where: SQL | undefined) =>
  db
    .select({
      generations: total,
      success: sql<number>`count(*) filter (where ${generation.status} = 'success')`.mapWith(
        Number,
      ),
      errors,
      pages: sum(generation.pageCount),
      bytes: sum(generation.size),
    })
    .from(generation)
    .where(where)
    .then(([row]) => row ?? { generations: 0, success: 0, errors: 0, pages: 0, bytes: 0 });

const byStatusOverTime = (where: SQL | undefined, w: Window) =>
  db
    .select({ t: bucketOf(generation.queuedAt, w), status: generation.status, count: total })
    .from(generation)
    .where(where)
    .groupBy(col(1), col(2))
    .orderBy(col(1));

const topTemplates = (where: SQL | undefined, limit = 10) =>
  db
    .select({
      templateId: sql<string>`${generation.templateId}`,
      name: template.name,
      generations: total,
      errors,
      p95TotalMs: percentile(0.95, generation.totalMs),
    })
    .from(generation)
    .innerJoin(template, eq(template.id, generation.templateId))
    .where(where)
    .groupBy(generation.templateId, template.name)
    .orderBy(desc(total))
    .limit(limit);

const oidcIds = new Set(ssoProviders.filter((p) => p.type === "oidc").map((p) => p.id));
const samlIds = new Set(ssoProviders.filter((p) => p.type === "saml").map((p) => p.id));

function channelOf(method: string | null, provider: string | null): SignInChannel {
  if (method === "password" || method === "trusted_header") return method;
  if (provider && oidcIds.has(provider)) return "oidc";
  if (provider && samlIds.has(provider)) return "saml";
  return "sso";
}

const detail = (key: string) => sql<string | null>`${auditEvent.details} ->> ${key}`;
const signInActions = inArray(auditEvent.action, ["auth.signed_in", "auth.sign_in_failed"]);
const failedSignIn = eq(auditEvent.action, "auth.sign_in_failed");
/** ISO text, as the JSON of a timestamp column would be. */
const iso = (aggregate: "min" | "max", column: AnyPgColumn) =>
  sql<string | null>`to_json(${sql.raw(aggregate)}(${column})) #>> '{}'`;

export const analyticsRoutes = new Hono<AppEnv>()
  .get(
    "/documents",
    requireRole("admin"),
    zValidator("query", documentAnalyticsQuerySchema),
    async (c) => {
      const { source, templateId, userId, apiKeyId, ...range } = c.req.valid("query");
      const w = toWindow(range);
      const where = and(
        inWindow(generation.queuedAt, w),
        source ? eq(generation.source, source) : undefined,
        templateId ? eq(generation.templateId, templateId) : undefined,
        userId ? eq(generation.userId, userId) : undefined,
        apiKeyId ? eq(generation.apiKeyId, apiKeyId) : undefined,
      );
      const [
        buckets,
        totals,
        byStatus,
        bySource,
        timings,
        templates,
        users,
        keys,
        topErrors,
        batches,
        shareLinks,
      ] = await Promise.all([
        bucketList(w),
        generationTotals(where),
        byStatusOverTime(where, w),
        db
          .select({ t: bucketOf(generation.queuedAt, w), source: generation.source, count: total })
          .from(generation)
          .where(where)
          .groupBy(col(1), col(2))
          .orderBy(col(1)),
        db
          .select({
            t: bucketOf(generation.queuedAt, w),
            queueP50: percentile(0.5, generation.queueWaitMs),
            queueP95: percentile(0.95, generation.queueWaitMs),
            runP50: percentile(0.5, generation.durationMs),
            runP95: percentile(0.95, generation.durationMs),
          })
          .from(generation)
          .where(and(where, finished))
          .groupBy(col(1))
          .orderBy(col(1)),
        topTemplates(where),
        db
          .select({
            userId: sql<string>`${generation.userId}`,
            name: user.name,
            email: user.email,
            generations: total,
            errors,
          })
          .from(generation)
          .innerJoin(user, eq(user.id, generation.userId))
          .where(where)
          .groupBy(generation.userId, user.name, user.email)
          .orderBy(desc(total))
          .limit(10),
        db
          .select({
            apiKeyId: sql<string>`${generation.apiKeyId}`,
            name: apikey.name,
            generations: total,
            errors,
          })
          .from(generation)
          .innerJoin(apikey, eq(apikey.id, generation.apiKeyId))
          .where(where)
          .groupBy(generation.apiKeyId, apikey.name)
          .orderBy(desc(total))
          .limit(10),
        db
          .select({
            message: sql<string>`left(split_part(${generation.error}, E'\n', 1), 300)`,
            count: total,
            lastAt: iso("max", generation.queuedAt),
          })
          .from(generation)
          .where(and(where, eq(generation.status, "error")))
          .groupBy(col(1))
          .orderBy(desc(total))
          .limit(10),
        db
          .select({
            batchId: sql<string>`${generation.batchId}`,
            templateName: batch.templateName,
            version: batch.version,
            total: batch.total,
            rows: total,
            errors,
            startedAt: iso("min", generation.startedAt),
            finishedAt: iso("max", generation.finishedAt),
            rowsPerMinute: sql<
              number | null
            >`(count(*) filter (where ${generation.finishedAt} is not null)
              / nullif(extract(epoch from max(${generation.finishedAt}) - min(${generation.startedAt})) / 60, 0))::float8`.mapWith(
              Number,
            ),
          })
          .from(generation)
          .innerJoin(batch, eq(batch.id, generation.batchId))
          .where(where)
          .groupBy(generation.batchId, batch.templateName, batch.version, batch.total)
          .orderBy(desc(total))
          .limit(10),
        // Links follow the date range and template filter; the other filters are about renders.
        db
          .select({
            id: shareLink.id,
            label: shareLink.label,
            templateId: shareLink.templateId,
            templateName: template.name,
            ownerName: user.name,
            views: shareLink.views,
            responses: linkResponses(w),
            lifetimeResponses:
              sql<number>`count(${submission.id}) filter (where ${submission.status} = 'finished')`.mapWith(
                Number,
              ),
          })
          .from(shareLink)
          .innerJoin(template, eq(template.id, shareLink.templateId))
          .innerJoin(user, eq(user.id, shareLink.ownerId))
          .leftJoin(submission, eq(submission.shareLinkId, shareLink.id))
          .where(
            and(
              lt(shareLink.createdAt, w.to),
              templateId ? eq(shareLink.templateId, templateId) : undefined,
            ),
          )
          .groupBy(shareLink.id, template.name, user.name)
          .orderBy(desc(linkResponses(w)), desc(shareLink.views))
          .limit(20),
      ]);
      return c.json({
        bucket: w.bucket,
        buckets,
        totals,
        byStatus,
        bySource,
        timings,
        templates,
        users,
        keys,
        errors: topErrors,
        batches,
        shareLinks: shareLinks.map((link) => ({
          ...link,
          conversion: link.views ? link.lifetimeResponses / link.views : null,
        })),
      });
    },
  )
  .get("/access", requireRole("admin"), zValidator("query", analyticsRangeSchema), async (c) => {
    const w = toWindow(c.req.valid("query"));
    const signIns = and(signInActions, inWindow(auditEvent.createdAt, w));
    const failed = and(failedSignIn, inWindow(auditEvent.createdAt, w));
    const day = 24 * 3_600_000;
    const since = (ms: number) => new Date(w.to.getTime() - ms);
    // Active: did something as themselves (audit log), or generated without a key. Read from
    // whichever is earlier, the range start or 30 days before its end (for MAU).
    const start = new Date(Math.min(w.from.getTime(), since(30 * day).getTime()));
    const activity = sql`(
      select ${auditEvent.createdAt} as at, ${auditEvent.actorId} as user_id from ${auditEvent}
        where ${auditEvent.actorKind} = 'user' and ${auditEvent.actorId} is not null
          and ${auditEvent.createdAt} >= ${at(start)} and ${auditEvent.createdAt} < ${at(w.to)}
      union all
      select ${generation.queuedAt}, ${generation.userId} from ${generation}
        where ${generation.userId} is not null and ${generation.apiKeyId} is null
          and ${generation.queuedAt} >= ${at(start)} and ${generation.queuedAt} < ${at(w.to)}
    )`;
    const [
      buckets,
      signInRows,
      reasons,
      emails,
      ips,
      activeRows,
      [activeTotals],
      newUsers,
      roleRows,
      keys,
      keyUse,
      accounts,
    ] = await Promise.all([
      bucketList(w),
      db
        .select({
          t: bucketOf(auditEvent.createdAt, w),
          failed: sql<boolean>`${auditEvent.action} = 'auth.sign_in_failed'`,
          method: detail("method"),
          provider: detail("provider"),
          count: total,
        })
        .from(auditEvent)
        .where(signIns)
        .groupBy(col(1), col(2), col(3), col(4))
        .orderBy(col(1)),
      db
        .select({ reason: detail("reason"), count: total })
        .from(auditEvent)
        .where(failed)
        .groupBy(col(1))
        .orderBy(desc(total))
        .limit(10),
      db
        .select({ email: detail("email"), count: total, lastAt: iso("max", auditEvent.createdAt) })
        .from(auditEvent)
        .where(failed)
        .groupBy(col(1))
        .orderBy(desc(total))
        .limit(10),
      db
        .select({ ip: auditEvent.ip, count: total, lastAt: iso("max", auditEvent.createdAt) })
        .from(auditEvent)
        .where(failed)
        .groupBy(auditEvent.ip)
        .orderBy(desc(total))
        .limit(10),
      db.execute<{ t: number; users: number }>(sql`
        select extract(epoch from date_trunc(${sql.raw(`'${w.bucket}'`)}, at, ${w.tz}))::float8 * 1000 as t,
          count(distinct user_id)::int as users
        from ${activity} a where at >= ${at(w.from)} group by 1 order by 1`),
      db.execute<{ inRange: number; daily: number; weekly: number; monthly: number }>(sql`
        select count(distinct user_id) filter (where at >= ${at(w.from)})::int as "inRange",
          count(distinct user_id) filter (where at >= ${at(since(day))})::int as daily,
          count(distinct user_id) filter (where at >= ${at(since(7 * day))})::int as weekly,
          count(distinct user_id) filter (where at >= ${at(since(30 * day))})::int as monthly
        from ${activity} a`),
      // Better Auth's timestamps are UTC without a zone.
      db
        .select({
          t: bucketOf(sql`${user.createdAt} at time zone 'UTC'`, w),
          count: total,
        })
        .from(user)
        .where(
          and(
            gte(user.createdAt, w.from),
            lt(user.createdAt, w.to),
            or(isNull(user.serviceAccount), eq(user.serviceAccount, false)),
          ),
        )
        .groupBy(col(1))
        .orderBy(col(1)),
      db
        .select({ role: user.role, count: total })
        .from(user)
        .where(or(isNull(user.serviceAccount), eq(user.serviceAccount, false)))
        .groupBy(user.role),
      db
        .select({
          id: apikey.id,
          name: apikey.name,
          ownerId: user.id,
          ownerName: user.name,
          serviceAccount: sql<boolean>`coalesce(${user.serviceAccount}, false)`,
          requests: apiKeyPolicy.requests,
          lastUsedAt: apiKeyPolicy.lastUsedAt,
          revokedAt: apiKeyPolicy.revokedAt,
          expiresAt: apiKeyPolicy.expiresAt,
        })
        .from(apikey)
        .innerJoin(apiKeyPolicy, eq(apiKeyPolicy.apiKeyId, apikey.id))
        .innerJoin(user, eq(user.id, apikey.referenceId))
        .orderBy(desc(apiKeyPolicy.requests))
        .limit(25),
      db
        .select({ apiKeyId: sql<string>`${generation.apiKeyId}`, generations: total, errors })
        .from(generation)
        .where(and(isNotNull(generation.apiKeyId), inWindow(generation.queuedAt, w)))
        .groupBy(generation.apiKeyId),
      db
        .select({
          userId: serviceAccount.userId,
          name: user.name,
          contact: serviceAccount.contact,
          disabled: sql<boolean>`coalesce(${user.banned}, false)`,
          keys: countDistinct(apikey.id),
          lastUsedAt: iso("max", apiKeyPolicy.lastUsedAt),
          generations: accountGenerations(w),
        })
        .from(serviceAccount)
        .innerJoin(user, eq(user.id, serviceAccount.userId))
        .leftJoin(apikey, eq(apikey.referenceId, serviceAccount.userId))
        .leftJoin(apiKeyPolicy, eq(apiKeyPolicy.apiKeyId, apikey.id))
        .groupBy(serviceAccount.userId, user.name, serviceAccount.contact, user.banned)
        .orderBy(desc(accountGenerations(w)), user.name),
    ]);

    // Sign-ins by bucket and channel, and by provider, from the same rows.
    const series = new Map<
      string,
      { t: number; channel: SignInChannel; ok: number; failed: number }
    >();
    const providers = new Map<
      string,
      { channel: SignInChannel; provider: string | null; ok: number; failed: number }
    >();
    for (const row of signInRows) {
      const channel = channelOf(row.method, row.provider);
      const point = series.get(`${row.t}:${channel}`) ?? { t: row.t, channel, ok: 0, failed: 0 };
      const byProvider = providers.get(`${channel}:${row.provider}`) ?? {
        channel,
        provider: row.provider,
        ok: 0,
        failed: 0,
      };
      point[row.failed ? "failed" : "ok"] += row.count;
      byProvider[row.failed ? "failed" : "ok"] += row.count;
      series.set(`${row.t}:${channel}`, point);
      providers.set(`${channel}:${row.provider}`, byProvider);
    }

    const roles = new Map<Role | "none", number>();
    for (const row of roleRows) {
      const parsed = parseRoles(row.role);
      for (const role of parsed.length ? parsed : (["none"] as const)) {
        roles.set(role, (roles.get(role) ?? 0) + row.count);
      }
    }
    const use = new Map(keyUse.map((row) => [row.apiKeyId, row]));

    return c.json({
      bucket: w.bucket,
      buckets,
      signIns: [...series.values()],
      providers: [...providers.values()].sort((a, b) => b.ok + b.failed - (a.ok + a.failed)),
      failures: { reasons, emails, ips },
      active: {
        series: activeRows.map((row) => ({ t: Number(row.t), users: Number(row.users) })),
        inRange: activeTotals?.inRange ?? 0,
        daily: activeTotals?.daily ?? 0,
        weekly: activeTotals?.weekly ?? 0,
        monthly: activeTotals?.monthly ?? 0,
      },
      newUsers,
      roles: [...roleSchema.options, "none" as const].map((role) => ({
        role,
        users: roles.get(role) ?? 0,
      })),
      keys: keys.map((key) => ({
        ...key,
        generations: use.get(key.id)?.generations ?? 0,
        errors: use.get(key.id)?.errors ?? 0,
      })),
      serviceAccounts: accounts,
    });
  })
  .get(
    "/me",
    requirePermission({ document: ["view"] }),
    zValidator("query", analyticsRangeSchema),
    async (c) => {
      const me = c.get("user");
      const w = toWindow(c.req.valid("query"));
      const mine = and(eq(generation.userId, me.id), inWindow(generation.queuedAt, w));
      const roles = parseRoles(me.role);
      const editor =
        hasPermission(roles, { document: ["create"] }) ||
        hasPermission(roles, { document: ["edit"] });
      const [buckets, totals, byStatus, templates, documents, templateUsage] = await Promise.all([
        bucketList(w),
        generationTotals(mine),
        byStatusOverTime(mine, w),
        topTemplates(mine),
        db
          .select({
            status: submission.status,
            source: submission.source,
            count: total,
            inRange:
              sql<number>`count(*) filter (where ${inRange(submission.createdAt, w)})`.mapWith(
                Number,
              ),
          })
          .from(submission)
          .where(eq(submission.ownerId, me.id))
          .groupBy(submission.status, submission.source),
        // Templates they created, generated by anyone in the range.
        editor
          ? db
              .select({
                templateId: template.id,
                name: template.name,
                generations: sql<number>`count(${generation.id})`.mapWith(Number),
                errors,
                users: countDistinct(generation.userId),
              })
              .from(template)
              .leftJoin(
                generation,
                and(eq(generation.templateId, template.id), inWindow(generation.queuedAt, w)),
              )
              .where(and(eq(template.createdBy, me.id), isNull(template.archivedAt)))
              .groupBy(template.id, template.name)
              .orderBy(desc(sql`count(${generation.id})`), template.name)
              .limit(20)
          : null,
      ]);
      return c.json({
        bucket: w.bucket,
        buckets,
        totals,
        byStatus,
        templates,
        documents,
        templateUsage,
      });
    },
  );
