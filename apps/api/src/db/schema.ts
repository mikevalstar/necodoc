import type {
  AcroField,
  AssetMime,
  CompiledOverlay,
  CompiledTemplate,
  DesignedContent,
  FieldSection,
  GenerationSource,
  GenerationStatus,
  OverlayContent,
  PageOptions,
  PdfPage,
  ProcessRole,
  RenderInput,
  RenderTimings,
  RetentionSettings,
  TemplateKind,
  ThemeInput,
  ThemeSettings,
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
  uuid,
} from "drizzle-orm/pg-core";
import type { StorageDriverName } from "../storage/config";
import { user } from "./auth-schema";

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
  cancelledAt: timestamp({ withTimezone: true }),
  createdAt,
});

// Spec: docs/features/generation-log.md. API key ids have no FK yet; the API key phase adds it.
// Rows are written queued by the API node and filled in by the worker that renders them (ADR 0020).
export const generation = pgTable(
  "generation",
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text().$type<GenerationSource>().notNull(),
    status: text().$type<GenerationStatus>().notNull(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text(),
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
type Settings = { retention: RetentionSettings };

export const setting = pgTable("setting", {
  key: text().$type<keyof Settings>().primaryKey(),
  value: jsonb().$type<Settings[keyof Settings]>().notNull(),
  updatedBy: text().references(() => user.id, { onDelete: "set null" }),
  updatedAt,
});

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
