import {
  type GenerationSource,
  type GenerationStatus,
  generationSourceSchema,
  generationStatusSchema,
} from "@necodoc/shared";
import { z } from "zod";
import { dayjs } from "@/lib/date";

// Spec: docs/features/generation-log.md (Filter bar). The log's filters as URL search params, and
// the typed tokens that mirror them both ways: `status:error,cancelled render:>0.5s since:7d`.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Relative start: "1h", "24h", "7d". */
const relative = z.string().regex(/^\d{1,4}[hd]$/);

/** Old links pass one value; the log takes several. */
const oneOrMore = <T extends z.ZodType<string>>(item: T) =>
  z
    .union([item, z.array(item)])
    .transform((value): z.output<T>[] => (Array.isArray(value) ? value : [value]))
    .optional();

/** The log's filters in the URL. Times are seconds, end to end. */
export const generationFiltersSearchSchema = z.object({
  q: z.string().optional(),
  source: oneOrMore(generationSourceSchema),
  status: oneOrMore(generationStatusSchema),
  userId: z.string().optional(),
  templateId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  /** Admin › API keys links here to show one key's calls. */
  apiKeyId: z.string().optional(),
  /** Inclusive days, YYYY-MM-DD in local time. */
  from: day.optional(),
  to: day.optional(),
  /** Queued in the last N hours or days; wins over `from`. */
  since: relative.optional(),
  /** At least this slow. */
  slowerThan: z.number().min(0).optional(),
  /** Faster than this (exclusive). */
  fasterThan: z.number().min(0).optional(),
});
export type GenerationFilters = z.output<typeof generationFiltersSearchSchema>;

export const filterKeys = Object.keys(
  generationFiltersSearchSchema.shape,
) as (keyof GenerationFilters)[];

/** Every filter unset: spread it under a parsed result so applying tokens replaces them all. */
export const noFilters = Object.fromEntries(filterKeys.map((key) => [key, undefined])) as {
  [K in keyof GenerationFilters]: undefined;
};

/** "7d" → the instant 7 days ago, to the minute (so the query key holds for a minute). */
export function sinceInstant(since: string, now = dayjs()) {
  const amount = Number(since.slice(0, -1));
  return now
    .subtract(amount, since.endsWith("h") ? "hour" : "day")
    .startOf("minute")
    .toISOString();
}

/** What the page has loaded, to turn names into ids and back. */
export type TokenLookups = {
  templates: readonly { id: string; name: string }[];
  /** Empty for non-admins, who can't filter by user. */
  users: readonly { id: string; name: string; email?: string }[];
  keys: readonly { id: string; name: string | null }[];
  batches: readonly { id: string; label: string }[];
  isAdmin: boolean;
};

const statusAliases: Record<string, GenerationStatus> = {
  ok: "success",
  done: "success",
  failed: "error",
  fail: "error",
  canceled: "cancelled",
};
const sourceAliases: Record<string, GenerationSource> = {
  "share-link": "share_link",
  link: "share_link",
  "re-run": "rerun",
};

const tokenKeys = [
  { key: "status", hint: "queued, running, success, error, cancelled" },
  { key: "source", hint: "app, api, share_link, combine, rerun, batch" },
  { key: "render", hint: "end to end: >0.5s, <2s, 0.5s..2s" },
  { key: "since", hint: "1h, 24h, 7d or a date" },
  { key: "until", hint: "a date, YYYY-MM-DD" },
  { key: "template", hint: "template name" },
  { key: "user", hint: "user name or email", adminOnly: true },
  { key: "key", hint: "API key name" },
  { key: "batch", hint: "batch id" },
] as const;
type TokenKey = (typeof tokenKeys)[number]["key"];
const keyAliases: Record<string, TokenKey> = { time: "render", total: "render", from: "since" };

const needsQuotes = (value: string) => /[\s,"]/.test(value);
const quote = (value: string) => (needsQuotes(value) ? `"${value.replaceAll('"', "")}"` : value);

/** Seconds without float noise: 0.5 → "0.5s". */
const seconds = (value: number) => `${Number(value.toFixed(3))}s`;

/** The URL's filters as tokens; free text goes last. */
export function serializeFilters(filters: GenerationFilters, lookups: TokenLookups) {
  const tokens: string[] = [];
  const nameOf = (list: readonly { id: string; name: string | null }[], id: string) =>
    quote(list.find((item) => item.id === id)?.name ?? id);
  if (filters.status?.length) tokens.push(`status:${filters.status.join(",")}`);
  if (filters.source?.length) tokens.push(`source:${filters.source.join(",")}`);
  const { slowerThan: min, fasterThan: max } = filters;
  if (min !== undefined && max !== undefined)
    tokens.push(`render:${seconds(min)}..${seconds(max)}`);
  else if (min !== undefined) tokens.push(`render:>${seconds(min)}`);
  else if (max !== undefined) tokens.push(`render:<${seconds(max)}`);
  if (filters.since) tokens.push(`since:${filters.since}`);
  else if (filters.from) tokens.push(`since:${filters.from}`);
  if (filters.to) tokens.push(`until:${filters.to}`);
  if (filters.templateId) tokens.push(`template:${nameOf(lookups.templates, filters.templateId)}`);
  if (filters.userId) tokens.push(`user:${nameOf(lookups.users, filters.userId)}`);
  if (filters.apiKeyId) tokens.push(`key:${nameOf(lookups.keys, filters.apiKeyId)}`);
  if (filters.batchId) tokens.push(`batch:${filters.batchId.slice(0, 8)}`);
  const q = filters.q?.trim();
  if (q) tokens.push(/[:"]/.test(q) ? `"${q.replaceAll('"', "")}"` : q);
  return tokens.join(" ");
}

/** Splits on spaces, keeping `"quoted text"` and `key:"quoted value"` whole. */
export function tokenize(text: string) {
  return text.match(/[^\s"]*"[^"]*"?|\S+/g) ?? [];
}

const unquote = (value: string) => value.replace(/^"|"$/g, "");

/** "0.5s", "500ms", "2" (seconds) → seconds. */
function parseSeconds(value: string) {
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2] === "ms" ? amount / 1000 : amount;
}

/** "error,failed" → ["error"]; unknown items are reported. Undefined when none are left. */
function parseList<T extends string>(
  key: string,
  options: readonly T[],
  aliases: Record<string, T>,
  value: string,
  errors: string[],
) {
  const isOption = (raw: string): raw is T => options.some((option) => option === raw);
  const values = new Set<T>();
  for (const part of value.split(",")) {
    const raw = part.trim().toLowerCase();
    const resolved = aliases[raw] ?? raw;
    if (!raw) continue;
    if (isOption(resolved)) values.add(resolved);
    else errors.push(`"${part.trim()}" isn't a ${key}. Use ${options.join(", ")}.`);
  }
  return values.size > 0 ? [...values] : undefined;
}

/** ">0.5s" (at least), "<2s" (under), "0.5s..2s" (both); a bare time means at least. */
function parseRender(value: string): { min?: number; max?: number } | null {
  const range = /^(.+?)\.\.(.+)$/.exec(value);
  if (range) {
    const min = parseSeconds(range[1] ?? "");
    const max = parseSeconds(range[2] ?? "");
    return min !== undefined && max !== undefined && max > min ? { min, max } : null;
  }
  if (value.startsWith("<")) {
    const max = parseSeconds(value.replace(/^<=?/, ""));
    return max === undefined ? null : { max };
  }
  const min = parseSeconds(value.replace(/^>=?/, ""));
  return min === undefined ? null : { min };
}

/** Exact name first (any case), then the first that contains it, then a raw id. */
function findByName<T extends { id: string }>(
  list: readonly T[],
  value: string,
  names: (item: T) => (string | null | undefined)[],
) {
  const needle = value.toLowerCase();
  const matches = (exact: boolean) =>
    list.find((item) =>
      names(item).some((name) => {
        const lower = name?.toLowerCase();
        return lower !== undefined && (exact ? lower === needle : lower.includes(needle));
      }),
    );
  return (matches(true) ?? matches(false) ?? list.find((item) => item.id === value))?.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedFilters = { filters: GenerationFilters; errors: string[] };

/** Tokens back into URL filters. Every filter is in the result, unset ones as undefined. */
export function parseFilters(text: string, lookups: TokenLookups): ParsedFilters {
  const filters: GenerationFilters = { ...noFilters };
  const errors: string[] = [];
  const words: string[] = [];

  for (const token of tokenize(text)) {
    const match = /^([a-z]+):(.*)$/i.exec(token);
    if (!match?.[1]) {
      words.push(unquote(token));
      continue;
    }
    const name = match[1].toLowerCase();
    const key = tokenKeys.find((k) => k.key === name)?.key ?? keyAliases[name];
    const value = unquote(match[2] ?? "").trim();
    if (!key) {
      errors.push(`Unknown filter "${name}". Try ${tokenKeys.map((k) => k.key).join(", ")}.`);
      continue;
    }
    if (!value) {
      errors.push(`"${name}:" needs a value.`);
      continue;
    }
    switch (key) {
      case "status":
        filters.status = parseList(
          key,
          generationStatusSchema.options,
          statusAliases,
          value,
          errors,
        );
        break;
      case "source":
        filters.source = parseList(
          key,
          generationSourceSchema.options,
          sourceAliases,
          value,
          errors,
        );
        break;
      case "render": {
        const range = parseRender(value);
        if (range) {
          filters.slowerThan = range.min;
          filters.fasterThan = range.max;
        } else {
          errors.push(`"${value}" isn't a render time. Try >0.5s, <2s or 0.5s..2s.`);
        }
        break;
      }
      case "since":
      case "until": {
        const lower = value.toLowerCase();
        if (key === "since" && relative.safeParse(lower).success) {
          filters.since = lower;
        } else if (day.safeParse(value).success && dayjs(value).isValid()) {
          if (key === "since") filters.from = value;
          else filters.to = value;
        } else {
          errors.push(
            key === "since"
              ? `"${value}" isn't a time. Use 1h, 24h, 7d or YYYY-MM-DD.`
              : `"${value}" isn't a date. Use YYYY-MM-DD.`,
          );
        }
        break;
      }
      case "template": {
        const id =
          findByName(lookups.templates, value, (t) => [t.name]) ??
          (UUID.test(value) ? value : undefined);
        if (id) filters.templateId = id;
        else errors.push(`No template matches "${value}".`);
        break;
      }
      case "user": {
        if (!lookups.isAdmin) {
          errors.push("Only admins can filter by user.");
          break;
        }
        const id = findByName(lookups.users, value, (u) => [u.name, u.email]);
        if (id) filters.userId = id;
        else errors.push(`No user matches "${value}".`);
        break;
      }
      case "key": {
        const id = findByName(lookups.keys, value, (k) => [k.name]);
        if (id) filters.apiKeyId = id;
        else errors.push(`No API key matches "${value}".`);
        break;
      }
      case "batch": {
        const lower = value.toLowerCase();
        const id =
          lookups.batches.find((b) => b.id.startsWith(lower))?.id ??
          (UUID.test(value) ? lower : undefined);
        if (id) filters.batchId = id;
        else errors.push(`No batch id starts with "${value}".`);
        break;
      }
    }
  }
  const q = words.join(" ").trim();
  if (q) filters.q = q;
  return { filters, errors };
}

export type Suggestion = {
  /** What the token becomes. */
  insert: string;
  label: string;
  hint?: string;
};

/** Completions for the token the caret is in, and where that token sits in the text. */
export function suggest(text: string, caret: number, lookups: TokenLookups) {
  const start = text.slice(0, caret).search(/\S*$/);
  const end = caret + (text.slice(caret).match(/^\S*/)?.[0].length ?? 0);
  const token = text.slice(start, end);
  const at = { start, end };
  const colon = token.indexOf(":");

  if (colon < 0) {
    const prefix = token.toLowerCase();
    const items = tokenKeys
      .filter((k) => !("adminOnly" in k) || lookups.isAdmin)
      .filter((k) => k.key.startsWith(prefix))
      .map((k): Suggestion => ({ insert: `${k.key}:`, label: `${k.key}:`, hint: k.hint }));
    return { ...at, items };
  }

  const name = token.slice(0, colon).toLowerCase();
  const key = tokenKeys.find((k) => k.key === name)?.key ?? keyAliases[name];
  const value = unquote(token.slice(colon + 1));
  // Lists complete their last item.
  const list = key === "status" || key === "source";
  const done = list ? value.slice(0, value.lastIndexOf(",") + 1) : "";
  const partial = (list ? value.slice(done.length) : value).toLowerCase();
  const option = (insert: string, label = insert, hint?: string): Suggestion => ({
    insert: `${name}:${done}${quote(insert)}`,
    label,
    hint,
  });
  const named = (items: { value: string; hint?: string }[]) =>
    items
      .filter((item) => item.value.toLowerCase().includes(partial))
      .map((item) => option(item.value, item.value, item.hint));

  let items: Suggestion[] = [];
  switch (key) {
    case "status":
    case "source": {
      const taken = done.split(",");
      const options =
        key === "status" ? generationStatusSchema.options : generationSourceSchema.options;
      items = options
        .filter((o) => !taken.includes(o) && o.startsWith(partial))
        .map((o) => option(o));
      break;
    }
    case "render":
      items = [">0.5s", ">1s", ">2s", ">5s", "<0.5s", "0.5s..2s"]
        .filter((o) => o.startsWith(partial))
        .map((o) => option(o));
      break;
    case "since":
      items = [
        { value: "1h", hint: "last hour" },
        { value: "24h", hint: "last 24 hours" },
        { value: "7d", hint: "last 7 days" },
        { value: "30d", hint: "last 30 days" },
      ]
        .filter((o) => o.value.startsWith(partial))
        .map((o) => option(o.value, o.value, o.hint));
      break;
    case "until":
      items = [option(dayjs().format("YYYY-MM-DD"), dayjs().format("YYYY-MM-DD"), "today")];
      break;
    case "template":
      items = named(lookups.templates.map((t) => ({ value: t.name })));
      break;
    case "user":
      items = lookups.isAdmin
        ? named(lookups.users.map((u) => ({ value: u.name, hint: u.email })))
        : [];
      break;
    case "key":
      items = named(lookups.keys.flatMap((k) => (k.name ? [{ value: k.name }] : [])));
      break;
    case "batch":
      items = lookups.batches
        .filter((b) => b.id.startsWith(partial) || b.label.toLowerCase().includes(partial))
        .map((b) => option(b.id.slice(0, 8), b.id.slice(0, 8), b.label));
      break;
  }
  return { ...at, items: items.slice(0, 8) };
}
