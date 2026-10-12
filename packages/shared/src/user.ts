import { z } from "zod";
import { roleSchema } from "./roles";

export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.email(),
});

export type User = z.infer<typeof userSchema>;

// Form payloads for Better Auth endpoints (ADR 0008). Better Auth's default password rule is 8-128.
const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters");
const nameSchema = z.string().trim().min(1, "Enter a name");

export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export const signUpSchema = z.object({
  name: nameSchema,
  email: z.email("Enter a valid email"),
  password: passwordSchema,
});

export const createUserSchema = signUpSchema.extend({ role: z.array(roleSchema) });

export const setRolesSchema = z.object({ role: z.array(roleSchema) });

export const setPasswordSchema = z.object({ newPassword: passwordSchema });

export const banUserSchema = z.object({ banReason: z.string().trim().max(500) });

// Admin > Users "Edit details". Users can't change their own email (docs/features/user-preferences.md).
export const updateUserDetailsSchema = z.object({
  name: nameSchema,
  email: z.email("Enter a valid email"),
});

// Settings (docs/features/user-preferences.md).
export const updateProfileSchema = z.object({ name: nameSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    revokeOtherSessions: z.boolean(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password"),
});

// Admin > Users list (GET /api/admin/users). People only; service accounts have their own page.
export const userStatusSchema = z.enum(["active", "pending", "banned"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const adminUserSortSchema = z.enum(["createdAt", "name", "email"]);
export type AdminUserSort = z.infer<typeof adminUserSortSchema>;

export const adminUserListQuerySchema = z.object({
  /** Part of the name or email, case-insensitive. */
  q: z.string().trim().max(200).optional(),
  role: roleSchema.optional(),
  /** Pending: no role yet; banned wins over both. */
  status: userStatusSchema.optional(),
  sort: adminUserSortSchema.default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
