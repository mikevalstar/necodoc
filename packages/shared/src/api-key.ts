import { z } from "zod";
import { type Permissions, roleSchema } from "./roles";

// Specs: docs/features/html-to-pdf-api.md (keys). ADR 0029: scopes narrow a key below its
// owner's roles; service accounts are users that can't sign in.

/** Every key's secret starts with this, so leaked keys are easy to spot and scan for. */
export const API_KEY_PREFIX = "nd_";

export const apiScopeSchema = z.enum([
  "render:html",
  "templates:read",
  "templates:generate",
  "batches:write",
  "batches:read",
  "generations:read",
  "combine:write",
]);
export type ApiScope = z.infer<typeof apiScopeSchema>;

/** What each scope allows, and the role permission its owner needs to be given it. */
export const apiScopes = {
  "render:html": { label: "Render HTML", needs: { document: ["view"] } },
  "templates:read": {
    label: "List templates and read their schemas",
    needs: { document: ["view"] },
  },
  "templates:generate": { label: "Generate from templates", needs: { document: ["view"] } },
  "batches:write": { label: "Start batches", needs: { document: ["view"] } },
  "batches:read": {
    label: "Read batches and download their ZIP or packet",
    needs: { document: ["view"] },
  },
  "generations:read": {
    label: "Read generations and download PDFs",
    needs: { document: ["view"] },
  },
  "combine:write": { label: "Combine PDFs into packets", needs: { document: ["view"] } },
} as const satisfies Record<ApiScope, { label: string; needs: Permissions }>;

/** One allowlist entry: an address or a CIDR range, IPv4 or IPv6. */
export const ipAllowEntrySchema = z
  .string()
  .trim()
  .pipe(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()], "Not an IP address or CIDR range"));

export const MAX_RATE_LIMIT_PER_MINUTE = 6000;

/** The settings a key is made with; rotation copies them. */
export const apiKeySettingsSchema = z.object({
  scopes: z.array(apiScopeSchema).min(1, "Pick at least one scope"),
  /** Empty: every template the owner can see. */
  templateIds: z.array(z.uuid()).max(100).default([]),
  /** Empty: any address. */
  ipAllowlist: z.array(ipAllowEntrySchema).max(50).default([]),
  rateLimitPerMinute: z.int().min(1).max(MAX_RATE_LIMIT_PER_MINUTE).default(120),
});

export const createApiKeySchema = apiKeySettingsSchema.extend({
  name: z.string().trim().min(1, "Enter a name").max(100),
  /** Days until it expires; null never expires. */
  expiresInDays: z.int().min(1).max(3650).nullable().default(null),
  /** A service account's id (admins only); omitted for your own key. */
  ownerId: z.string().min(1).optional(),
});
export type CreateApiKey = z.infer<typeof createApiKeySchema>;
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export const rotateApiKeySchema = z.object({
  /** How long the old key keeps working beside its replacement. */
  overlapHours: z
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),
});

export const apiKeyStatusSchema = z.enum(["active", "expired", "revoked"]);
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;

export const apiKeyListQuerySchema = z.object({
  /** Admins: any owner, or every key when omitted. Others always get their own. */
  ownerId: z.string().optional(),
  ownerKind: z.enum(["user", "service"]).optional(),
  status: apiKeyStatusSchema.optional(),
  /** Every key (admins), rather than your own. */
  all: z.enum(["true", "false"]).optional(),
});

/** Derived from the policy row; never stored. */
export function apiKeyStatus(
  key: { revokedAt: Date | string | null; expiresAt: Date | string | null },
  now = Date.now(),
): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now) return "expired";
  return "active";
}

/** Keys expiring sooner than this are flagged in lists. */
export const EXPIRY_WARNING_DAYS = 14;

// ---------------------------------------------------------------------------------------------
// Service accounts

/** No admin: a key's scopes never need it, and an admin identity nobody signs in as is a liability. */
const roles = z.array(roleSchema.exclude(["admin"])).min(1, "Pick at least one role");

const serviceAccountFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  description: z.string().trim().max(2000),
  /** Who to ask about it: a team, a person, an email or a channel. */
  contact: z.string().trim().min(1, "Enter an owner or contact").max(200),
  roles,
});

export const createServiceAccountSchema = serviceAccountFields.extend({
  description: serviceAccountFields.shape.description.default(""),
});
export type CreateServiceAccount = z.infer<typeof createServiceAccountSchema>;

/** Only what's sent changes (no defaults here, or a partial update would reset fields). */
export const updateServiceAccountSchema = serviceAccountFields
  .partial()
  .extend({ disabled: z.boolean().optional() });
export type UpdateServiceAccount = z.infer<typeof updateServiceAccountSchema>;
