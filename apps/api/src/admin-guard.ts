import { parseRoles } from "@necodoc/shared";
import { z } from "zod";

// Guards from docs/features/user-management-and-roles.md: an admin can't ban,
// delete, or demote themselves, and the last active admin can't lose admin.
// docs/features/user-preferences.md adds: the last active admin can't delete their own account,
// and nobody changes their own email, admins included.
//
// Before-hooks see the raw body before the endpoint validates it, so this reads it
// leniently and fails closed: anything it can't read as "keeps admin" counts as losing it.

const guardedBody = z.looseObject({
  userId: z.coerce.string(),
  role: z.unknown().optional(),
  data: z.unknown().optional(),
});
const roleInput = z.union([z.string(), z.array(z.string())]);

function keepsAdmin(role: unknown): boolean {
  const parsed = roleInput.safeParse(role);
  return parsed.success && parseRoles([parsed.data].flat().join(",")).includes("admin");
}

export type AdminChange = { targetId: string; staysAdmin: boolean };

/**
 * What a call to an admin plugin endpoint does to the target's admin access: null when it
 * can't take admin away, "unreadable" when a guarded endpoint gets a body we can't read.
 */
export function adminChange(path: string, body: unknown): AdminChange | "unreadable" | null {
  if (
    !["/admin/set-role", "/admin/ban-user", "/admin/remove-user", "/admin/update-user"].includes(
      path,
    )
  ) {
    return null;
  }
  const parsed = guardedBody.safeParse(body);
  if (!parsed.success) return "unreadable";
  const { userId: targetId, role, data } = parsed.data;
  switch (path) {
    case "/admin/set-role":
      return { targetId, staysAdmin: keepsAdmin(role) };
    case "/admin/update-user": {
      if (typeof data !== "object" || data === null) return "unreadable";
      // Only an explicit `false` leaves the ban state harmless; null, "true", 1 all count as a ban.
      if ("banned" in data && data.banned !== false) return { targetId, staysAdmin: false };
      return "role" in data ? { targetId, staysAdmin: keepsAdmin(data.role) } : null;
    }
    default:
      return { targetId, staysAdmin: false };
  }
}

/** Returns why the change is refused, or null when it's allowed. */
export function adminGuardError(
  actorId: string,
  change: AdminChange | "unreadable",
  activeAdminIds: ReadonlySet<string>,
): string | null {
  if (change === "unreadable") return "Invalid request.";
  if (change.staysAdmin || !activeAdminIds.has(change.targetId)) return null;
  if (change.targetId === actorId) {
    return "You can't ban, delete, or remove the admin role from yourself.";
  }
  if (activeAdminIds.size <= 1) return "You can't remove the last admin.";
  return null;
}

/** Why a user can't delete their own account (Settings), or null when they can. */
export function selfDeleteError(
  userId: string,
  activeAdminIds: ReadonlySet<string>,
): string | null {
  if (activeAdminIds.has(userId) && activeAdminIds.size <= 1) {
    return "You're the last admin. Make someone else an admin before deleting your account.";
  }
  return null;
}

/**
 * The target's id when an admin update-user call sets an email, else null. Unreadable bodies
 * return null here because adminChange already refuses them.
 */
export function emailChangeTarget(path: string, body: unknown): string | null {
  if (path !== "/admin/update-user") return null;
  const parsed = guardedBody.safeParse(body);
  if (!parsed.success) return null;
  const { userId, data } = parsed.data;
  return typeof data === "object" && data !== null && "email" in data ? userId : null;
}
