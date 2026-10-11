import type { Readable } from "node:stream";
import type { Context } from "hono";
import { db } from "./db";
import { downloadLink } from "./db/schema";
import { contentDisposition, etagMatches, parseRange } from "./download-headers";
import { env } from "./env";
import { findFile, openFile } from "./files";
import { signLink } from "./signed-link";
import { storage } from "./storage";

// ADR 0023: the one download path for stored outputs, session or signed link. Streams from the
// driver with ETag revalidation and single-range requests. Callers check permission first.

export const signingSecret = env.DOWNLOAD_SIGNING_SECRET ?? env.BETTER_AUTH_SECRET;

/** A presigned URL only has to outlive the redirect. */
const PRESIGNED_SECONDS = 300;

/**
 * A Node stream as the web stream Hono sends, pulled on demand (so a slow client slows the read)
 * and destroyed if the client goes away. Built by hand: `Readable.toWeb` and
 * `ReadableStream.from` don't type-check under the app's DOM typings, which see this file.
 */
function webStream(source: Readable) {
  const chunks: AsyncIterator<Uint8Array> = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      source.destroy();
    },
  });
}

/**
 * Serves a file inline, or as an attachment with `?download=1`. `redirect: false` always proxies:
 * a POST answered with a cross-origin redirect is no use to the app.
 */
export async function serveFile(
  c: Context,
  {
    fileId,
    filename,
    headers: extra = {},
    redirect = true,
  }: { fileId: string; filename: string; headers?: Record<string, string>; redirect?: boolean },
) {
  const stored = await findFile(db, fileId);
  if (!stored) return c.json({ error: "File not found" }, 404);
  const disposition = contentDisposition(
    c.req.query("download") === "1" ? "attachment" : "inline",
    filename,
  );
  if (
    redirect &&
    env.STORAGE_REDIRECT === "presigned" &&
    storage.presign &&
    stored.storage === storage.name
  ) {
    const url = await storage.presign(stored.key, {
      expiresInSeconds: PRESIGNED_SECONDS,
      contentType: stored.mimeType,
      contentDisposition: disposition,
    });
    return c.redirect(url, 302);
  }
  const etag = `"${stored.sha256}"`;
  const headers = {
    "Content-Type": stored.mimeType,
    "Content-Disposition": disposition,
    ETag: etag,
    // Revalidate every time: a 304 is cheap, and a deleted output must stop being served.
    "Cache-Control": "private, no-cache",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
  if (etagMatches(c.req.header("If-None-Match"), etag)) return c.body(null, 304, headers);
  // If-Range: resume only if the file is still the one the client has part of.
  const ifRange = c.req.header("If-Range");
  const range =
    !ifRange || ifRange === etag ? parseRange(c.req.header("Range"), stored.size) : null;
  if (range === "unsatisfiable") {
    return c.body(null, 416, { ...headers, "Content-Range": `bytes */${stored.size}` });
  }
  const body = webStream(await openFile(db, stored, range ?? undefined));
  if (range) {
    return c.body(body, 206, {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${stored.size}`,
      "Content-Length": String(range.end - range.start + 1),
    });
  }
  return c.body(body, 200, { ...headers, "Content-Length": String(stored.size) });
}

/** Records the link (who minted it, for which generation) and returns its URL. */
export async function mintLink({
  fileId,
  generationId,
  userId,
  expiresInSeconds,
}: {
  fileId: string;
  generationId: string;
  userId: string;
  expiresInSeconds: number;
}) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const [link] = await db
    .insert(downloadLink)
    .values({ fileId, generationId, createdBy: userId, expiresAt: new Date(expiresAt * 1000) })
    .returning({ id: downloadLink.id });
  if (!link) throw new Error("Download link insert returned no row");
  // Audit hook (docs/features/audit-log.md): record "download link minted" here.
  const token = signLink({ fileId, linkId: link.id, expiresAt }, signingSecret);
  return {
    url: new URL(`/api/files/signed/${token}`, env.BETTER_AUTH_URL).href,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}
