import type { ByteRange } from "./storage";

// HTTP pieces of a download (src/download.ts), kept pure for tests.

/**
 * Reads a `Range` header against a file's size. Only single `bytes=` ranges are served; anything
 * else (several ranges, other units, nonsense) is ignored, which RFC 9110 allows, and the whole
 * file goes out.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (!first && !last) return null;
  if (!first) {
    // Suffix: the last N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last ? Number(last) : Number.POSITIVE_INFINITY;
  if (end < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}

/** `If-None-Match` against an ETag, weak comparison as RFC 9110 asks for GET. */
export function etagMatches(header: string | undefined, etag: string) {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === bare);
}

/** RFC 6266: an ASCII `filename` for old clients plus the exact name in `filename*`. */
export function contentDisposition(type: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
