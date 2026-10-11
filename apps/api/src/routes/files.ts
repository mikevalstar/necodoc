import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { downloadLink, generation } from "../db/schema";
import { serveFile, signingSecret } from "../download";
import type { AppEnv } from "../middleware";
import { verifyLink } from "../signed-link";

// Spec: docs/features/generation-log.md (signed links), ADR 0023. No session: the token is the
// permission, checked by its signature and expiry.

export const fileRoutes = new Hono<AppEnv>().get("/signed/:token", async (c) => {
  const check = verifyLink(c.req.param("token"), signingSecret);
  if (!check.ok) {
    return check.reason === "expired"
      ? c.json({ error: "This link has expired" }, 410)
      : c.json({ error: "This link isn't valid" }, 403);
  }
  const { fileId, linkId } = check.claims;
  // Deleting the generation (or retention removing its output) ends the link early.
  const [owner] = await db
    .select({ filename: generation.filename })
    .from(generation)
    .where(eq(generation.outputFileId, fileId));
  if (!owner) return c.json({ error: "This file no longer exists" }, 404);
  // Range requests count as uses too; it's a usage signal, not an exact download count.
  await db
    .update(downloadLink)
    .set({ downloads: sql`${downloadLink.downloads} + 1`, lastUsedAt: new Date() })
    .where(eq(downloadLink.id, linkId));
  // Audit hook (docs/features/audit-log.md): record the use with the link's minter here.
  return serveFile(c, { fileId, filename: owner.filename });
});
