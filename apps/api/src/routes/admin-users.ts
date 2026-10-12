import { zValidator } from "@hono/zod-validator";
import { type AdminUserListQuery, adminUserListQuerySchema, roleSchema } from "@necodoc/shared";
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user } from "../db/schema";
import { type AppEnv, requireRole } from "../middleware";

// Spec: docs/features/user-management-and-roles.md (Admin > Users). Better Auth's listUsers takes
// one filter, so the list is read here: people only (service accounts have their own page,
// ADR 0029), with search, role, status, sort and paging done in Postgres. Changes still go through
// Better Auth's admin endpoints.

const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/** The roles column split the way parseRoles reads it ("admin, editor"). */
const roleList = sql`regexp_split_to_array(coalesce(${user.role}, ''), '\\s*,\\s*')`;
const knownRoles = sql`array[${sql.join(
  roleSchema.options.map((role) => sql`${role}`),
  sql`, `,
)}]::text[]`;
const hasAnyRole = sql`${roleList} && ${knownRoles}`;
const notBanned = or(isNull(user.banned), eq(user.banned, false));

function listWhere({ q, role, status }: AdminUserListQuery): SQL | undefined {
  const pattern = q ? `%${escapeLike(q)}%` : undefined;
  return and(
    or(isNull(user.serviceAccount), eq(user.serviceAccount, false)),
    pattern ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined,
    role ? sql`${role} = any(${roleList})` : undefined,
    status === "banned" ? eq(user.banned, true) : undefined,
    status === "pending" ? and(notBanned, sql`not (${hasAnyRole})`) : undefined,
    status === "active" ? and(notBanned, hasAnyRole) : undefined,
  );
}

const columns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: user.banned,
  banReason: user.banReason,
  banExpires: user.banExpires,
  createdAt: user.createdAt,
};

export const adminUserRoutes = new Hono<AppEnv>().get(
  "/",
  requireRole("admin"),
  zValidator("query", adminUserListQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const where = listWhere(query);
    const direction = query.order === "asc" ? asc : desc;
    const [users, [total]] = await Promise.all([
      db
        .select(columns)
        .from(user)
        .where(where)
        .orderBy(direction(user[query.sort]), direction(user.id))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ count: count() }).from(user).where(where),
    ]);
    return c.json({ users, total: total?.count ?? 0 }, 200);
  },
);
