// Spec: docs/features/audit-log.md, ADR 0032. What an audit entry keeps of a change; pure, so
// it's tested without a database (audit.ts writes the entry).

type Fields = Record<string, unknown>;

/** Never recorded: secrets, and timestamps that change on every write. */
const omitted = new Set(["secret", "token", "password", "newPassword", "currentPassword"]);
const noise = new Set(["updatedAt", "createdAt"]);

/** Plain JSON with sorted keys, so equal values compare equal however they were built. */
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

/**
 * Keeps the fields that changed, each whole (a rich-text body is stored entire). A create keeps
 * all of `after`, a delete all of `before`. Secrets never go in.
 */
export function changedFields(before: Fields | null | undefined, after: Fields | null | undefined) {
  const clean = (fields: Fields, keep: (key: string) => boolean) =>
    Object.fromEntries(
      Object.entries(fields)
        .filter(([key, value]) => !omitted.has(key) && value !== undefined && keep(key))
        .map(([key, value]) => [key, stable(value)]),
    );
  if (!before || !after) {
    return {
      before: before ? clean(before, () => true) : null,
      after: after ? clean(after, () => true) : null,
    };
  }
  const changed = (key: string) =>
    !noise.has(key) && JSON.stringify(stable(before[key])) !== JSON.stringify(stable(after[key]));
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(changed);
  if (!keys.some((key) => !omitted.has(key))) return { before: null, after: null };
  return { before: clean(before, changed), after: clean(after, changed) };
}

/** Fields as plain JSON (dates as ISO strings). */
export const plainFields = (fields: Fields): Fields =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, stable(value)]));
