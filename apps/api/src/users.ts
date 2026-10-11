import { parseRoles } from "@necodoc/shared";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { db } from "./db";
import { user } from "./db/schema";

// User lookups shared by auth.ts (admin guards, ADR 0029) and sso.ts (role sync, ADR 0031).

/** Unbanned users holding admin. The LIKE only narrows; parseRoles decides. */
export async function activeAdminIds() {
  const admins = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(and(like(user.role, "%admin%"), or(isNull(user.banned), eq(user.banned, false))));
  return new Set(admins.filter((a) => parseRoles(a.role).includes("admin")).map((a) => a.id));
}

export async function isServiceAccount(id: string) {
  const [row] = await db
    .select({ serviceAccount: user.serviceAccount })
    .from(user)
    .where(eq(user.id, id));
  return row?.serviceAccount === true;
}
