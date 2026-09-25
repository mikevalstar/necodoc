import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { z } from "zod";

// Spec: docs/features/user-management-and-roles.md
export const roleSchema = z.enum(["admin", "publisher", "reviewer", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const statements = {
  ...defaultStatements,
  document: ["create", "edit", "review", "publish", "view"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  admin: ac.newRole({ ...adminAc.statements, document: statements.document }),
  publisher: ac.newRole({ document: ["view", "publish"] }),
  reviewer: ac.newRole({ document: ["view", "review"] }),
  editor: ac.newRole({ document: ["view", "create", "edit"] }),
  viewer: ac.newRole({ document: ["view"] }),
} satisfies Record<Role, unknown>;

export type Permissions = {
  [R in keyof typeof statements]?: ReadonlyArray<(typeof statements)[R][number]>;
};

/** Parses Better Auth's comma-separated `user.role` in `roleSchema` order; unknown names are dropped. */
export function parseRoles(value: string | null | undefined): Role[] {
  const names = new Set((value ?? "").split(",").map((name) => name.trim()));
  return roleSchema.options.filter((role) => names.has(role));
}

/**
 * Roles add up: every requested action must be granted by at least one role.
 * (The admin plugin's own check needs a single role to grant the whole request.)
 */
export function hasPermission(userRoles: readonly Role[], permissions: Permissions): boolean {
  return Object.entries(permissions).every(([resource, actions]) =>
    actions.every((action) =>
      userRoles.some((role) => {
        const granted: Partial<Record<string, readonly string[]>> = roles[role].statements;
        return granted[resource]?.includes(action) ?? false;
      }),
    ),
  );
}
