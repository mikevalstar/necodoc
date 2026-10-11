import { z } from "zod";

// Spec: docs/features/audit-log.md, ADR 0032. The catalogue: every action and the type of thing
// it acts on. The API records only these; the app labels and filters by them.

export const auditTargetTypes = [
  "template",
  "theme",
  "asset",
  "snippet",
  "share_link",
  "webhook",
  "api_key",
  "service_account",
  "user",
  "batch",
  "generation",
  "setting",
] as const;
export const auditTargetTypeSchema = z.enum(auditTargetTypes);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

export const auditActions = {
  "template.created": "template",
  "template.updated": "template",
  "template.duplicated": "template",
  "template.archived": "template",
  "template.unarchived": "template",
  "template.deleted": "template",
  "template.published": "template",
  "template.review_submitted": "template",
  "template.review_approved": "template",
  "template.review_changes_requested": "template",
  "template.review_withdrawn": "template",

  "theme.created": "theme",
  "theme.updated": "theme",
  "theme.deleted": "theme",
  "asset.created": "asset",
  "asset.updated": "asset",
  "asset.deleted": "asset",
  "snippet.created": "snippet",
  "snippet.updated": "snippet",
  "snippet.deleted": "snippet",

  "share_link.created": "share_link",
  "share_link.updated": "share_link",
  "share_link.deleted": "share_link",
  "webhook.created": "webhook",
  "webhook.updated": "webhook",
  "webhook.deleted": "webhook",

  "api_key.created": "api_key",
  "api_key.rotated": "api_key",
  "api_key.revoked": "api_key",
  "service_account.created": "service_account",
  "service_account.updated": "service_account",

  "user.created": "user",
  "user.updated": "user",
  "user.role_changed": "user",
  "user.banned": "user",
  "user.unbanned": "user",
  "user.deleted": "user",
  "user.password_set": "user",
  "user.sessions_revoked": "user",
  "user.impersonation_started": "user",
  "user.impersonation_stopped": "user",
  /** Own account, from Settings. */
  "account.updated": "user",
  "account.password_changed": "user",
  "account.sessions_revoked": "user",
  "account.deleted": "user",
  "auth.signed_in": "user",
  "auth.sign_in_failed": "user",
  "auth.signed_out": "user",

  "batch.started": "batch",
  "batch.cancelled": "batch",
  "generation.bulk_deleted": "generation",
  "generation.link_created": "generation",
  "settings.retention_updated": "setting",
  "settings.publishing_updated": "setting",
} as const satisfies Record<string, AuditTargetType>;

export type AuditAction = keyof typeof auditActions;
export type AuditTargetOf<A extends AuditAction> = (typeof auditActions)[A];
export const auditActionSchema = z.enum(
  Object.keys(auditActions) as [AuditAction, ...AuditAction[]],
);

/**
 * Who acted. `api_key` and `service_account` are calls made with a key (its owner is the actor
 * id); `system` is the app itself (SSO provisioning, jobs); `public` is nobody signed in.
 */
export const auditActorKindSchema = z.enum([
  "user",
  "api_key",
  "service_account",
  "system",
  "public",
]);
export type AuditActorKind = z.infer<typeof auditActorKindSchema>;

export const signInMethodSchema = z.enum(["password", "sso", "trusted_header"]);
export type SignInMethod = z.infer<typeof signInMethodSchema>;

export const auditFilterSchema = z.object({
  actorId: z.string().optional(),
  actorKind: auditActorKindSchema.optional(),
  action: auditActionSchema.optional(),
  targetType: auditTargetTypeSchema.optional(),
  targetId: z.string().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Substring of the target or actor name, request id or IP, or an exact target id. */
  q: z.string().trim().min(1).max(200).optional(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

export const auditSortSchema = z.enum(["createdAt", "action", "targetType", "actorName"]);
export type AuditSort = z.infer<typeof auditSortSchema>;

export const auditListQuerySchema = auditFilterSchema.extend({
  sort: auditSortSchema.default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Changed fields only: before has their old values, after their new ones. */
const fields = z.record(z.string(), z.unknown()).nullable();

export const auditEventSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  actorKind: auditActorKindSchema,
  actorId: z.string().nullable(),
  /** As it was when recorded. */
  actorName: z.string().nullable(),
  impersonatorId: z.string().nullable(),
  impersonatorName: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  action: auditActionSchema,
  targetType: auditTargetTypeSchema,
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  requestId: z.string().nullable(),
  ip: z.string().nullable(),
});
export type AuditEventSummary = z.infer<typeof auditEventSchema>;

export const auditEventDetailSchema = auditEventSchema.extend({
  before: fields,
  after: fields,
  details: fields,
  userAgent: z.string().nullable(),
});
export type AuditEventDetail = z.infer<typeof auditEventDetailSchema>;
