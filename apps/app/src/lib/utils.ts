export { cn } from "cn";

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** 87 → "87 ms", 1234 → "1.23 s", 12345 → "12.3 s"; null (not finished) → "—". */
export const formatMs = (ms: number | null) =>
  ms === null
    ? "—"
    : ms < 1000
      ? `${Math.round(ms)} ms`
      : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/** "1 page", "3 pages"; pass `many` for irregular plurals ("1 box", "2 boxes"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
