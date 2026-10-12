import { zValidator } from "@hono/zod-validator";
import { type AuditFilter, auditFilterSchema, auditListQuerySchema, toCsv } from "@necodoc/shared";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { alias, type SelectedFields } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { db, escapeLike } from "../db";
import { auditEvent, user } from "../db/schema";
import { type AppEnv, requireRole } from "../middleware";

// Spec: docs/features/audit-log.md, ADR 0032. Admins only, read only: nothing here (or anywhere)
// edits or deletes entries. Object pages ask for their own history with targetType + targetId.

/** An id or address matches exactly; anything else is a substring of a name or request id. */
function textMatch(q: string) {
  if (z.union([z.ipv4(), z.ipv6()]).safeParse(q).success) return eq(auditEvent.ip, q);
  const pattern = `%${escapeLike(q)}%`;
  return or(
    eq(auditEvent.targetId, q),
    eq(auditEvent.requestId, q),
    ilike(auditEvent.targetName, pattern),
    ilike(auditEvent.actorName, pattern),
    ilike(auditEvent.requestId, pattern),
  );
}

function filterWhere(filter: AuditFilter) {
  return and(
    filter.actorId ? eq(auditEvent.actorId, filter.actorId) : undefined,
    filter.actorKind ? eq(auditEvent.actorKind, filter.actorKind) : undefined,
    filter.action ? eq(auditEvent.action, filter.action) : undefined,
    filter.targetType ? eq(auditEvent.targetType, filter.targetType) : undefined,
    filter.targetId ? eq(auditEvent.targetId, filter.targetId) : undefined,
    filter.from ? gte(auditEvent.createdAt, new Date(filter.from)) : undefined,
    filter.to ? lte(auditEvent.createdAt, new Date(filter.to)) : undefined,
    filter.q ? textMatch(filter.q) : undefined,
  );
}

const impersonator = alias(user, "impersonator");

const summaryColumns = {
  id: auditEvent.id,
  createdAt: auditEvent.createdAt,
  actorKind: auditEvent.actorKind,
  actorId: auditEvent.actorId,
  actorName: auditEvent.actorName,
  impersonatorId: auditEvent.impersonatorId,
  impersonatorName: impersonator.name,
  apiKeyId: auditEvent.apiKeyId,
  action: auditEvent.action,
  targetType: auditEvent.targetType,
  targetId: auditEvent.targetId,
  targetName: auditEvent.targetName,
  requestId: auditEvent.requestId,
  ip: auditEvent.ip,
};

const detailColumns = {
  ...summaryColumns,
  before: auditEvent.before,
  after: auditEvent.after,
  details: auditEvent.details,
  userAgent: auditEvent.userAgent,
};

const selectEvents = <T extends SelectedFields>(columns: T) =>
  db
    .select(columns)
    .from(auditEvent)
    .leftJoin(impersonator, eq(impersonator.id, auditEvent.impersonatorId));

const exportColumns = [
  "createdAt",
  "action",
  "targetType",
  "targetId",
  "targetName",
  "actorKind",
  "actorId",
  "actorName",
  "impersonatorId",
  "impersonatorName",
  "apiKeyId",
  "ip",
  "userAgent",
  "requestId",
  "before",
  "after",
  "details",
] as const satisfies readonly (keyof typeof detailColumns)[];

/** Rows per database round trip while streaming the export. */
const EXPORT_CHUNK = 2000;

export const auditRoutes = new Hono<AppEnv>()
  .get("/", requireRole("admin"), zValidator("query", auditListQuerySchema), async (c) => {
    const { sort, order, limit, offset, ...filter } = c.req.valid("query");
    const where = filterWhere(filter);
    const direction = order === "asc" ? asc : desc;
    const [items, [total]] = await Promise.all([
      selectEvents(summaryColumns)
        .where(where)
        .orderBy(
          direction(auditEvent[sort]),
          direction(auditEvent.createdAt),
          direction(auditEvent.id),
        )
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(auditEvent).where(where),
    ]);
    return c.json({ items, total: total?.count ?? 0 });
  })
  // Streamed in keyset-paged chunks, newest first, so a large export never sits in memory.
  .get("/export.csv", requireRole("admin"), zValidator("query", auditFilterSchema), (c) => {
    const where = filterWhere(c.req.valid("query"));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return stream(c, async (out) => {
      await out.write(`${toCsv([exportColumns])}\r\n`);
      // The cursor keeps Postgres's microseconds, which a JS Date would round away.
      let after: { at: string; id: string } | null = null;
      for (;;) {
        const rows = await selectEvents({
          ...detailColumns,
          cursor: sql<string>`${auditEvent.createdAt}::text`,
        })
          .where(
            and(
              where,
              after
                ? sql`(${auditEvent.createdAt}, ${auditEvent.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
          .limit(EXPORT_CHUNK);
        if (!rows.length) break;
        const csv = toCsv(
          rows.map((row) =>
            exportColumns.map((column) => {
              const value = row[column];
              if (value instanceof Date) return value.toISOString();
              return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
            }),
          ),
        );
        await out.write(`${csv}\r\n`);
        const last = rows.at(-1);
        if (!last || rows.length < EXPORT_CHUNK) break;
        after = { at: last.cursor, id: last.id };
      }
    });
  })
  .get("/:id", requireRole("admin"), zValidator("param", z.object({ id: z.uuid() })), async (c) => {
    const [row] = await selectEvents(detailColumns).where(
      eq(auditEvent.id, c.req.valid("param").id),
    );
    return row ? c.json(row, 200) : c.json({ error: "Audit entry not found" }, 404);
  });
