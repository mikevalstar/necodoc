import type {
  AcroField,
  ApiScope,
  AssetMime,
  AuditAction,
  AuditActorKind,
  AuditTargetType,
  CompiledOverlay,
  CompiledTemplate,
  DesignedContent,
  FieldSection,
  GenerationSource,
  GenerationStatus,
  NotificationKind,
  OutputProfile,
  OverlayContent,
  PageOptions,
  PdfPage,
  ProcessRole,
  PublishingSettings,
  RenderInput,
  RenderTimings,
  RetentionSettings,
  ReviewEventKind,
  ReviewStatus,
  SigningPackage,
  SnippetContent,
  SubmissionSource,
  SubmissionStatus,
  TemplateKind,
  TestAssertions,
  TestCaseSource,
  ThemeInput,
  ThemeSettings,
  WebhookAttempt,
  WebhookDeliveryStatus,
  WebhookEvent,
} from "@necodoc/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { StorageDriverName } from "../storage/config";
import { apikey, user } from "./auth-schema";

export * from "./auth-schema";

// Reads copy out of the driver's Buffer, which may be a view into a shared pool.
const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value),
});

const createdAt = timestamp({ withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp({ withTimezone: true })
  .defaultNow()
  .$onUpdate(() => new Date())
  .notNull();

/** Where a file's bytes are: in its row, or in a storage driver under `key` (ADR 0023). */
export type FileStorage = "db" | StorageDriverName;

// Every stored binary: uploads, assets, generated PDFs (ADR 0014). Written once; list queries
// select metadata only. Other tables point here by id. Base data keeps its bytes in the row;
// generated outputs live in the storage driver (ADR 0023). Read and write through src/files.ts.
export const file = pgTable(
  "file",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text().references(() => user.id, { onDelete: "set null" }),
    mimeType: text().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    storage: text().$type<FileStorage>().default("db").notNull(),
    key: text(),
    bytes: bytea(),
    createdAt,
  },
  (t) => [
    check(
      "file_location",
      sql`(${t.storage} = 'db' and ${t.bytes} is not null and ${t.key} is null) or (${t.storage} <> 'db' and ${t.bytes} is null and ${t.key} is not null)`,
    ),
  ],
);

// Spec: docs/features/assets.md
export const asset = pgTable("asset", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  mimeType: text().$type<AssetMime>().notNull(),
  fileId: uuid()
    .notNull()
    .references(() => file.id),
  uploadedBy: text().references(() => user.id, { onDelete: "set null" }),
  createdAt,
});

// Spec: docs/features/pdf-overlay-templates.md. An uploaded PDF an overlay template fills, with
// what the API read from it (ADR 0028). Immutable, like its file: a new revision is a new row,
// so published versions keep pointing at the PDF they were made from.
export const pdfSource = pgTable("pdf_source", {
  id: uuid().primaryKey().defaultRandom(),
  fileId: uuid()
    .notNull()
    .references(() => file.id),
  filename: text().notNull(),
  pages: jsonb().$type<PdfPage[]>().notNull(),
  fields: jsonb().$type<AcroField[]>().notNull(),
  /** Encrypted with an empty password (ADR 0027). */
  encrypted: boolean().notNull(),
  /** Hybrid XFA + AcroForm. */
  xfa: boolean().notNull(),
  uploadedBy: text().references(() => user.id, { onDelete: "set null" }),
  createdAt,
});

// Spec: docs/features/document-themes.md. Built-ins are seeded at boot (src/builtin-themes.ts).
export const theme = pgTable("theme", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  builtIn: boolean().default(false).notNull(),
  settings: jsonb().$type<ThemeSettings>().notNull(),
  css: text().default("").notNull(),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  createdAt,
  updatedAt,
});

// Specs: docs/features/document-templates.md, docs/features/publishing-and-versions.md. The row
// is the one working draft; publishing copies it into template_version.
export const template = pgTable("template", {
  id: uuid().primaryKey().defaultRandom(),
  kind: text().$type<TemplateKind>().notNull(),
  name: text().notNull(),
  description: text().default("").notNull(),
  sections: jsonb().$type<FieldSection[]>().notNull(),
  sampleData: jsonb().$type<Record<string, unknown>>().notNull(),
  themeId: uuid().references(() => theme.id, { onDelete: "set null" }),
  page: jsonb().$type<PageOptions>().notNull(),
  /** By kind: DesignedContent or OverlayContent (overlays ignore themeId and page). */
  content: jsonb().$type<DesignedContent | OverlayContent>().notNull(),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  archivedAt: timestamp({ withTimezone: true }),
  createdAt,
  updatedAt,
});

// Immutable: never updated. Holds everything a render needs, theme included, so later theme
// edits don't change it; `compiled` is the HTML the version renders, so compiler changes don't
// either. A template with versions can't be deleted (archive it instead).
export const templateVersion = pgTable(
  "template_version",
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references(() => template.id),
    version: integer().notNull(),
    kind: text().$type<TemplateKind>().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    sections: jsonb().$type<FieldSection[]>().notNull(),
    sampleData: jsonb().$type<Record<string, unknown>>().notNull(),
    themeId: uuid().references(() => theme.id, { onDelete: "set null" }),
    theme: jsonb().$type<ThemeInput | null>(),
    page: jsonb().$type<PageOptions>().notNull(),
    /** By kind: DesignedContent or OverlayContent (overlays ignore themeId and page). */
    content: jsonb().$type<DesignedContent | OverlayContent>().notNull(),
    compiled: jsonb().$type<CompiledTemplate | CompiledOverlay>().notNull(),
    note: text(),
    publishedBy: text().references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.templateId, t.version)],
);

// Spec: docs/features/snippet-library.md. Current content only: published template versions keep
// their own compiled copy (compiled.partials), so editing a snippet never changes one.
export const snippet = pgTable("snippet", {
  id: uuid().primaryKey().defaultRandom(),
  /** Set once; `{% render 'key' %}` names it. */
  key: text().notNull().unique(),
  name: text().notNull(),
  description: text().default("").notNull(),
  tags: text().array().default(sql`'{}'::text[]`).notNull(),
  /** Top-level field keys it expects. */
  fields: jsonb().$type<string[]>().notNull(),
  content: jsonb().$type<SnippetContent>().notNull(),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  archivedAt: timestamp({ withTimezone: true }),
  createdAt,
  updatedAt,
});

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md. One request that generates many
// documents; each row is a generation pointing here. Progress and status are counted from those.
export const batch = pgTable("batch", {
  id: uuid().primaryKey().defaultRandom(),
  userId: text().references(() => user.id, { onDelete: "set null" }),
  templateId: uuid().references(() => template.id, { onDelete: "set null" }),
  templateVersionId: uuid().references(() => templateVersion.id, { onDelete: "set null" }),
  templateName: text().notNull(),
  version: integer().notNull(),
  total: integer().notNull(),
  requestId: text(),
  /** Started through /api/v1 with this key (docs/features/webhooks.md). */
  apiKeyId: text().references(() => apikey.id, { onDelete: "set null" }),
  cancelledAt: timestamp({ withTimezone: true }),
  /** Set once, by whoever finished the last row; that call fires batch.completed. */
  completedAt: timestamp({ withTimezone: true }),
  createdAt,
});

// Spec: docs/features/generation-log.md. Rows are written queued by the API node and filled in by the worker that renders them (ADR 0020).
export const generation = pgTable(
  "generation",
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().$type<GenerationSource>().notNull(),
    status: text().$type<GenerationStatus>().notNull(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text().references(() => apikey.id, { onDelete: "set null" }),
    templateId: uuid().references(() => template.id, { onDelete: "set null" }),
    templateVersionId: uuid().references(() => templateVersion.id, { onDelete: "set null" }),
    rerunOfId: uuid().references((): AnyPgColumn => generation.id, { onDelete: "set null" }),
    batchId: uuid().references(() => batch.id, { onDelete: "set null" }),
    /** 1-based row number within the batch. */
    batchRow: integer(),
    requestId: text(),
    filename: text().notNull(),
    error: text(),
    warnings: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    /** Null once retention removed it. */
    input: jsonb().$type<RenderInput>(),
    /** Who it's about, for erasure (docs/features/personal-data-masking-and-erasure.md). */
    subject: text(),
    outputFileId: uuid().references(() => file.id, { onDelete: "set null" }),
    queuedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    /** Run time on the worker. */
    durationMs: integer(),
    queueWaitMs: integer(),
    /** Queued to finished. */
    totalMs: integer(),
    timings: jsonb().$type<RenderTimings>(),
    /** Signers and sign box positions (docs/features/signing-packages.md); null without any. */
    signing: jsonb().$type<SigningPackage>(),
    /** PDF/A, PDF/UA and certification as applied (ADR 0037, ADR 0038); null without any. */
    outputProfile: jsonb().$type<OutputProfile>(),
    /** Attempts started; above 1 means a retry after an infrastructure failure. */
    attempts: integer().default(0).notNull(),
    /** host:pid of the process that ran the last attempt. */
    workerId: text(),
    pageCount: integer(),
    size: integer(),
  },
  (t) => [
    index().on(t.queuedAt),
    index().on(t.userId, t.queuedAt),
    index().on(t.batchId, t.batchRow),
    index("generation_unfinished_index")
      .on(t.status)
      .where(sql`${t.status} in ('queued', 'running')`),
    // Server-side sorting of the log at tens of thousands of rows.
    index().on(t.startedAt),
    index().on(t.finishedAt),
    index().on(t.durationMs),
    index().on(t.totalMs),
    index().on(t.queueWaitMs),
    index().on(t.pageCount),
    index().on(t.size),
    index().on(t.templateId, t.queuedAt),
    index().on(t.status, t.queuedAt),
    index().on(t.source, t.queuedAt),
    index().on(t.apiKeyId, t.queuedAt),
    // The self-reference's ON DELETE SET NULL scans for re-runs of every deleted row.
    index().on(t.rerunOfId),
    // Erasure looks subjects up case-insensitively.
    index("generation_subject_index").on(sql`lower(${t.subject})`),
    // Free-text search (`q`): substring matches need trigrams (migration enables pg_trgm).
    index("generation_filename_trgm_index").using("gin", t.filename.op("gin_trgm_ops")),
    index("generation_error_trgm_index").using("gin", t.error.op("gin_trgm_ops")),
    index("generation_request_id_trgm_index").using("gin", t.requestId.op("gin_trgm_ops")),
  ],
);

// Spec: docs/features/render-queue-batch-jobs-and-scaling.md (workers). Every process upserts its
// row every few seconds; a row not refreshed recently is offline.
export const worker = pgTable("worker", {
  /** host:pid */
  id: text().primaryKey(),
  host: text().notNull(),
  pid: integer().notNull(),
  version: text().notNull(),
  role: text().$type<ProcessRole>().notNull(),
  concurrency: integer().notNull(),
  running: integer().notNull(),
  eventLoopLagMs: integer().notNull(),
  startedAt: timestamp({ withTimezone: true }).notNull(),
  lastSeen: timestamp({ withTimezone: true }).notNull(),
});

/** Admin settings, one typed row per key. */
type Settings = { retention: RetentionSettings; publishing: PublishingSettings };

export const setting = pgTable("setting", {
  key: text().$type<keyof Settings>().primaryKey(),
  value: jsonb().$type<Settings[keyof Settings]>().notNull(),
  updatedBy: text().references(() => user.id, { onDelete: "set null" }),
  updatedAt,
});

// ADR 0029: what a service account is beyond its user row (marked `serviceAccount`, which can't
// sign in). Its roles, name and disabled state (a ban) live on the user row like anyone's.
export const serviceAccount = pgTable("service_account", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  description: text().default("").notNull(),
  /** Who to ask about it: a team, a person, an email or a channel. */
  contact: text().notNull(),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  createdAt,
  updatedAt,
});

// ADR 0029: the policy for one Better Auth key, and the source of truth for whether it may be
// used. Expired and revoked keys keep their rows, so lists and the generation log still name them.
export const apiKeyPolicy = pgTable("api_key_policy", {
  apiKeyId: text()
    .primaryKey()
    .references(() => apikey.id, { onDelete: "cascade" }),
  scopes: jsonb().$type<ApiScope[]>().notNull(),
  /** Empty: every template the owner can see. */
  templateIds: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  /** Addresses and CIDR ranges; empty allows any. */
  ipAllowlist: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  expiresAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  revokedBy: text().references(() => user.id, { onDelete: "set null" }),
  /** The key this one replaced, when it was made by rotating. */
  rotatedFromId: text().references(() => apikey.id, { onDelete: "set null" }),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  /** Every authenticated call, ever (the plugin's own count resets each rate-limit window). */
  requests: integer().default(0).notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  lastUsedIp: text(),
  createdAt,
});

// Spec: docs/features/webhooks.md. Fires for its owner's API generations, narrowed to one key
// and/or one template; a template webhook alone fires for every generation of the template.
export const webhook = pgTable(
  "webhook",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text().notNull(),
    description: text().default("").notNull(),
    /** Signs every request; shown once. Kept in plain text because signing needs it. */
    secret: text().notNull(),
    events: jsonb().$type<WebhookEvent[]>().notNull(),
    apiKeyId: text().references(() => apikey.id, { onDelete: "cascade" }),
    templateId: uuid().references(() => template.id, { onDelete: "cascade" }),
    enabled: boolean().default(true).notNull(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [index().on(t.ownerId), index().on(t.apiKeyId), index().on(t.templateId)],
);

// One event for one webhook; each POST is an entry in `attempts`. Sent from a pg-boss queue.
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid().primaryKey().defaultRandom(),
    webhookId: uuid()
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    event: text().notNull(),
    /** The JSON body, signed as sent. */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().$type<WebhookDeliveryStatus>().default("pending").notNull(),
    attempts: jsonb().$type<WebhookAttempt[]>().default(sql`'[]'::jsonb`).notNull(),
    generationId: uuid().references(() => generation.id, { onDelete: "set null" }),
    batchId: uuid().references(() => batch.id, { onDelete: "set null" }),
    createdAt,
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.webhookId, t.createdAt)],
);

// Spec: docs/features/generation-log.md (signed links). One row per minted link: who made it and
// how often it was used. The token itself carries the file id and expiry (src/signed-link.ts).
export const downloadLink = pgTable("download_link", {
  id: uuid().primaryKey().defaultRandom(),
  fileId: uuid().references(() => file.id, { onDelete: "set null" }),
  generationId: uuid().references(() => generation.id, { onDelete: "set null" }),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  downloads: integer().default(0).notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  createdAt,
});

// Spec: docs/features/share-links-and-data-requests.md. A public link to a published template;
// whoever has the token can submit. Submissions become the owner's documents.
export const shareLink = pgTable("share_link", {
  id: uuid().primaryKey().defaultRandom(),
  /** 32 random bytes, base64url: the only secret. */
  token: text().notNull().unique(),
  ownerId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  templateId: uuid()
    .notNull()
    .references(() => template.id),
  /** Pinned version; null follows the latest published one. */
  templateVersionId: uuid().references(() => templateVersion.id),
  label: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }),
  maxSubmissions: integer(),
  requireEmail: boolean().default(false).notNull(),
  allowDownload: boolean().default(true).notNull(),
  prefill: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  lockedKeys: jsonb().$type<string[]>().default([]).notNull(),
  disabledAt: timestamp({ withTimezone: true }),
  /** Loads of the public page, lifetime (docs/features/analytics-dashboards.md: conversion). */
  views: integer().default(0).notNull(),
  /** When the owner last opened the responses; later ones count as unseen. */
  seenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  createdAt,
  updatedAt,
});

// Spec: docs/features/filling-out-a-document.md. One document being filled: raw answers (checked
// only for shape until finished), pinned to the version it was started on. `generationId` is its
// current PDF; regenerating points it at the new entry.
export const submission = pgTable(
  "submission",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    templateId: uuid()
      .notNull()
      .references(() => template.id),
    templateVersionId: uuid()
      .notNull()
      .references(() => templateVersion.id),
    name: text().notNull(),
    status: text().$type<SubmissionStatus>().default("draft").notNull(),
    source: text().$type<SubmissionSource>().default("app").notNull(),
    shareLinkId: uuid().references(() => shareLink.id, { onDelete: "set null" }),
    /** The share-link filler's address, when the link asked for one. */
    respondentEmail: text(),
    data: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    step: integer().default(0).notNull(),
    /** The language picked while filling (docs/features/document-localization.md); null: the template's. */
    locale: text(),
    generationId: uuid().references(() => generation.id, { onDelete: "set null" }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [index().on(t.ownerId, t.updatedAt), index().on(t.shareLinkId, t.createdAt)],
);

// Spec: docs/features/review-and-approval.md. One submission of a template's draft. `fingerprint`
// hashes what publishing would freeze (src/publish.ts): a draft whose fingerprint moved on since
// is stale. At most one open review (pending, changes requested, approved) per template.
export const templateReview = pgTable(
  "template_review",
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),
    status: text().$type<ReviewStatus>().default("pending").notNull(),
    fingerprint: text().notNull(),
    /** The latest published version when submitted; what the diff compares with. */
    baseVersion: integer(),
    note: text(),
    submittedBy: text().references(() => user.id, { onDelete: "set null" }),
    submittedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    decidedBy: text().references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
    templateVersionId: uuid().references(() => templateVersion.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index().on(t.templateId, t.createdAt),
    index().on(t.status),
    uniqueIndex("template_review_open_index")
      .on(t.templateId)
      .where(sql`${t.status} in ('pending', 'changes_requested', 'approved')`),
  ],
);

// The review's thread: comments, and every state change with the comment that came with it.
export const templateReviewEvent = pgTable(
  "template_review_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewId: uuid()
      .notNull()
      .references(() => templateReview.id, { onDelete: "cascade" }),
    kind: text().$type<ReviewEventKind>().notNull(),
    body: text(),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [index().on(t.reviewId, t.createdAt)],
);

// In-app notifications (the nav bell), polled. Spec: docs/features/review-and-approval.md.
export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text().$type<NotificationKind>().notNull(),
    message: text().notNull(),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    templateId: uuid().references(() => template.id, { onDelete: "cascade" }),
    reviewId: uuid().references(() => templateReview.id, { onDelete: "cascade" }),
    readAt: timestamp({ withTimezone: true }),
    createdAt,
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

// Spec: docs/features/template-test-cases-and-visual-diff.md. Named data a template is checked
// with before review and publish.
export const templateTestCase = pgTable(
  "template_test_case",
  {
    id: uuid().primaryKey().defaultRandom(),
    templateId: uuid()
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),
    name: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    assertions: jsonb().$type<TestAssertions>().notNull(),
    source: text().$type<TestCaseSource>().notNull(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [unique().on(t.templateId, t.name)],
);

// Spec: docs/features/audit-log.md, ADR 0032. Append-only: a trigger (migration 0013) rejects
// UPDATE, DELETE and TRUNCATE. No foreign keys, so deleting what an entry names never touches it.
// Written only through src/audit.ts.
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt,
    actorKind: text().$type<AuditActorKind>().notNull(),
    actorId: text(),
    /** The actor's name when recorded. */
    actorName: text(),
    /** The admin behind an impersonated session. */
    impersonatorId: text(),
    apiKeyId: text(),
    action: text().$type<AuditAction>().notNull(),
    targetType: text().$type<AuditTargetType>().notNull(),
    targetId: text(),
    targetName: text(),
    /** Changed fields only, each whole. */
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    details: jsonb().$type<Record<string, unknown>>(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
  },
  (t) => [
    index().on(t.createdAt, t.id),
    index().on(t.actorId, t.createdAt),
    index().on(t.action, t.createdAt),
    index().on(t.targetType, t.targetId, t.createdAt),
    index().on(t.actorName),
    // Free text (`q`): an id, an address, or a substring (trigrams, migration 0005).
    index().on(t.targetId),
    index().on(t.ip),
    index("audit_event_target_name_trgm_index").using("gin", t.targetName.op("gin_trgm_ops")),
    index("audit_event_actor_name_trgm_index").using("gin", t.actorName.op("gin_trgm_ops")),
    index("audit_event_request_id_trgm_index").using("gin", t.requestId.op("gin_trgm_ops")),
  ],
);
