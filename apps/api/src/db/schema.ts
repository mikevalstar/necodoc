import type {
  AssetMime,
  CompiledTemplate,
  DesignedContent,
  FieldSection,
  GenerationSource,
  GenerationStatus,
  PageOptions,
  RenderRequest,
  TemplateKind,
  ThemeInput,
  ThemeSettings,
} from "@necodoc/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
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

// Every stored binary: uploads, assets, generated PDFs (ADR 0014). Written once; list queries
// select metadata only. Other tables point here by id.
export const file = pgTable("file", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text().references(() => user.id, { onDelete: "set null" }),
  mimeType: text().notNull(),
  size: integer().notNull(),
  sha256: text().notNull(),
  bytes: bytea().notNull(),
  createdAt,
});

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
  content: jsonb().$type<DesignedContent>().notNull(),
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
    content: jsonb().$type<DesignedContent>().notNull(),
    compiled: jsonb().$type<CompiledTemplate>().notNull(),
    note: text(),
    publishedBy: text().references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.templateId, t.version)],
);

// Spec: docs/features/generation-log.md. API key ids have no FK yet; the API key phase adds it.
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
    filename: text().notNull(),
    error: text(),
    warnings: jsonb().$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    input: jsonb().$type<RenderRequest>().notNull(),
    outputFileId: uuid().references(() => file.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    durationMs: integer().notNull(),
    pageCount: integer(),
    size: integer(),
  },
  (t) => [index().on(t.startedAt), index().on(t.userId, t.startedAt)],
);
