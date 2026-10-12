import {
  type AssetUsage,
  stableStringify,
  type ThemeInput,
  type ThemeUsage,
} from "@necodoc/shared";
import { desc, isNotNull, type SQL, sql } from "drizzle-orm";
import { db } from "./db";
import { asset, snippet, template, templateVersion, theme } from "./db/schema";

// Specs: docs/features/assets.md, docs/features/document-themes.md. Where assets and themes are
// used. Assets are referenced by id in many shapes (an image node's assetId, `asset_url` in
// Liquid, the asset origin URL in CSS, a theme's or overlay box's font), so usage is any asset id
// appearing in the stored JSON or CSS. Published versions are read from what they froze: the
// compiled template (snippets included) and the theme copy.

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** The ids of existing assets that appear in `text`, found by Postgres so big rows stay there. */
const assetIdsIn = (text: SQL) =>
  sql<string[]>`array(
    select distinct lower(m[1]) from regexp_matches(${text}, ${UUID}, 'g') as m
    where lower(m[1]) in (select ${asset.id}::text from ${asset})
  )`;

type TemplateRow = { id: string; name: string; archivedAt: Date | null };
type TemplateUse<V> = {
  id: string;
  name: string;
  archived: boolean;
  draft: boolean;
  versions: V[];
};

function getOrAdd<K, V>(map: Map<K, V>, key: K, make: () => V) {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

/** The entry for a template in a usage list, added on first use. */
function templateUse<V>(list: TemplateUse<V>[], templates: TemplateRow[], templateId: string) {
  let use = list.find((t) => t.id === templateId);
  if (!use) {
    const row = templates.find((t) => t.id === templateId);
    use = {
      id: templateId,
      name: row?.name ?? "",
      archived: Boolean(row?.archivedAt),
      draft: false,
      versions: [],
    };
    list.push(use);
  }
  return use;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

type Named = { id: string; name: string; ids: string[] };
export type AssetSources = {
  templates: (TemplateRow & { ids: string[] })[];
  /** Newest first. */
  versions: { templateId: string; version: number; ids: string[] }[];
  themes: Named[];
  snippets: Named[];
};

/** Asset id → what uses it. Assets nothing uses are absent. */
export function groupAssetUsage(sources: AssetSources) {
  const usages = new Map<string, AssetUsage>();
  const usageOf = (id: string) =>
    getOrAdd(usages, id, (): AssetUsage => ({ templates: [], themes: [], snippets: [] }));
  const use = (id: string, templateId: string) =>
    templateUse(usageOf(id).templates, sources.templates, templateId);
  for (const row of sources.templates) {
    for (const id of row.ids) use(id, row.id).draft = true;
  }
  for (const row of sources.versions) {
    for (const id of row.ids) use(id, row.templateId).versions.push(row.version);
  }
  for (const row of sources.themes) {
    for (const id of row.ids) usageOf(id).themes.push({ id: row.id, name: row.name });
  }
  for (const row of sources.snippets) {
    for (const id of row.ids) usageOf(id).snippets.push({ id: row.id, name: row.name });
  }
  for (const usage of usages.values()) usage.templates.sort(byName);
  return usages;
}

const noUsage: AssetUsage = { templates: [], themes: [], snippets: [] };

/** Every asset's usage; `get` gives an empty usage for unused ones. */
export async function assetUsages() {
  const [templates, versions, themes, snippets] = await Promise.all([
    db
      .select({
        id: template.id,
        name: template.name,
        archivedAt: template.archivedAt,
        ids: assetIdsIn(sql`${template.content}::text`),
      })
      .from(template)
      .orderBy(template.name),
    db
      .select({
        templateId: templateVersion.templateId,
        version: templateVersion.version,
        ids: assetIdsIn(
          sql`${templateVersion.compiled}::text || coalesce(${templateVersion.theme}::text, '')`,
        ),
      })
      .from(templateVersion)
      .orderBy(desc(templateVersion.version)),
    db
      .select({
        id: theme.id,
        name: theme.name,
        ids: assetIdsIn(sql`${theme.settings}::text || ${theme.css}`),
      })
      .from(theme),
    db
      .select({
        id: snippet.id,
        name: snippet.name,
        ids: assetIdsIn(sql`${snippet.content}::text`),
      })
      .from(snippet),
  ]);
  const usages = groupAssetUsage({ templates, versions, themes, snippets });
  return { get: (id: string) => usages.get(id) ?? noUsage };
}

export type ThemeSources = {
  themes: ({ id: string } & ThemeInput)[];
  templates: (TemplateRow & { themeId: string | null })[];
  /** Newest first. */
  versions: {
    templateId: string;
    version: number;
    themeId: string | null;
    theme: ThemeInput | null;
  }[];
};

/** Theme id → the templates using it, each version marked current or an older copy. */
export function groupThemeUsage(sources: ThemeSources) {
  const usages = new Map<string, ThemeUsage>();
  const current = new Map(
    sources.themes.map((t) => [t.id, stableStringify({ settings: t.settings, css: t.css })]),
  );
  const use = (themeId: string, templateId: string) =>
    templateUse(
      getOrAdd(usages, themeId, (): ThemeUsage => ({ templates: [] })).templates,
      sources.templates,
      templateId,
    );
  for (const row of sources.templates) {
    if (row.themeId) use(row.themeId, row.id).draft = true;
  }
  for (const row of sources.versions) {
    if (!row.themeId) continue;
    const copy = row.theme && stableStringify({ settings: row.theme.settings, css: row.theme.css });
    use(row.themeId, row.templateId).versions.push({
      version: row.version,
      current: copy === current.get(row.themeId),
    });
  }
  for (const usage of usages.values()) usage.templates.sort(byName);
  return usages;
}

/** Every theme's usage; `get` gives an empty usage for unused ones. */
export async function themeUsages() {
  const [themes, templates, versions] = await Promise.all([
    db.select({ id: theme.id, settings: theme.settings, css: theme.css }).from(theme),
    db
      .select({
        id: template.id,
        name: template.name,
        archivedAt: template.archivedAt,
        themeId: template.themeId,
      })
      .from(template),
    db
      .select({
        templateId: templateVersion.templateId,
        version: templateVersion.version,
        themeId: templateVersion.themeId,
        theme: templateVersion.theme,
      })
      .from(templateVersion)
      .where(isNotNull(templateVersion.themeId))
      .orderBy(desc(templateVersion.version)),
  ]);
  const usages = groupThemeUsage({ themes, templates, versions });
  return { get: (id: string): ThemeUsage => usages.get(id) ?? { templates: [] } };
}
