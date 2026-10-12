import { randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { zValidator } from "@hono/zod-validator";
import {
  createShareLinkSchema,
  fieldAnswers,
  fieldErrors,
  type ShareLinkUnavailable,
  shareSubmitSchema,
  templateDataSchema,
  updateShareLinkSchema,
} from "@necodoc/shared";
import { and, count, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { recordAudit } from "../audit";
import { db } from "../db";
import { shareLink, submission, template, templateVersion } from "../db/schema";
import { mintLink } from "../download";
import { env } from "../env";
import { type AppEnv, requirePermission } from "../middleware";
import { tokenBucket } from "../rate-limit";
import { finishSubmission, selectSubmissions, versionLocalization } from "./submissions";
import { findVersion } from "./templates";

// Spec: docs/features/share-links-and-data-requests.md. Owners (document: publish) manage their
// links under /share-links; anyone with a token opens and submits under /share, no session.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

const canPublish = requirePermission({ document: ["publish"] });
const idParam = zValidator("param", z.object({ id: z.uuid() }));
const tokenParam = zValidator("param", z.object({ token: z.string().min(20).max(100) }));

/** How long a filler's download link lasts. */
const DOWNLOAD_SECONDS = 24 * 60 * 60;

/** Ten submissions in a burst per address, then one a minute. */
const submitLimit = tokenBucket({ capacity: 10, refillMs: 60_000 });

const submissionCount = sql<number>`(select count(*) from ${submission} where ${submission.shareLinkId} = ${shareLink.id})`;
/** Responses since views started counting (shareLink.viewsSince), for conversion. */
const viewedCount = sql<number>`(select count(*) from ${submission} where ${submission.shareLinkId} = ${shareLink.id} and ${submission.createdAt} >= ${shareLink.viewsSince})`;
const unseenCount = sql<number>`(select count(*) from ${submission} where ${submission.shareLinkId} = ${shareLink.id} and ${submission.createdAt} > ${shareLink.seenAt})`;

const linkColumns = {
  ...getTableColumns(shareLink),
  templateName: template.name,
  version: templateVersion.version,
  submissions: submissionCount.mapWith(Number),
  unseen: unseenCount.mapWith(Number),
  viewedSubmissions: viewedCount.mapWith(Number),
};

const selectLinks = () =>
  db
    .select(linkColumns)
    .from(shareLink)
    .innerJoin(template, eq(template.id, shareLink.templateId))
    .leftJoin(templateVersion, eq(templateVersion.id, shareLink.templateVersionId))
    .$dynamic();

const own = (ownerId: string, id: string) =>
  and(eq(shareLink.id, id), eq(shareLink.ownerId, ownerId));

/** The version a link fills: its pinned one, or the template's latest. */
async function linkVersion(tx: Tx, templateId: string, templateVersionId: string | null) {
  const [version] = await tx
    .select()
    .from(templateVersion)
    .where(
      templateVersionId
        ? eq(templateVersion.id, templateVersionId)
        : and(
            eq(templateVersion.templateId, templateId),
            eq(
              templateVersion.version,
              sql`(select max(${templateVersion.version}) from ${templateVersion} where ${templateVersion.templateId} = ${templateId})`,
            ),
          ),
    );
  return version ?? null;
}

/** Locked keys must be prefilled, and both only name this template's top-level fields. */
function cleanPrefill(
  sections: Parameters<typeof fieldAnswers>[0],
  prefill: Record<string, unknown>,
  lockedKeys: readonly string[],
) {
  const kept = fieldAnswers(sections, prefill);
  return { prefill: kept, lockedKeys: lockedKeys.filter((key) => Object.hasOwn(kept, key)) };
}

export const shareLinkRoutes = new Hono<AppEnv>()
  .get("/", canPublish, async (c) => {
    const rows = await selectLinks()
      .where(eq(shareLink.ownerId, c.get("user").id))
      .orderBy(desc(shareLink.createdAt));
    return c.json(rows, 200);
  })
  .post("/", canPublish, zValidator("json", createShareLinkSchema), async (c) => {
    const { version, templateId, prefill, lockedKeys, ...options } = c.req.valid("json");
    const actor = c.get("user");
    const found = await findVersion(actor, templateId, version ?? "latest");
    if (!found) return c.json({ error: "Template version not found" }, 404);
    if (found.archivedAt) return c.json({ error: "This template is archived" }, 409);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(shareLink)
        .values({
          ...options,
          ...cleanPrefill(found.version.sections, prefill, lockedKeys),
          expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
          token: randomBytes(32).toString("base64url"),
          ownerId: actor.id,
          templateId,
          templateVersionId: version === null ? null : found.version.id,
        })
        .returning();
      if (!created) return undefined;
      await recordAudit(
        {
          action: "share_link.created",
          target: { id: created.id, name: created.label },
          after: created,
          sections: found.version.sections,
        },
        tx,
      );
      return { id: created.id };
    });
    return c.json(row, 201);
  })
  .patch("/:id", canPublish, idParam, zValidator("json", updateShareLinkSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { version, disabled, expiresAt, prefill, lockedKeys, ...options } = c.req.valid("json");
    const actor = c.get("user");
    const [existing] = await db.select().from(shareLink).where(own(actor.id, id));
    if (!existing) return c.json({ error: "Share link not found" }, 404);
    let templateVersionId = existing.templateVersionId;
    if (version === null) templateVersionId = null;
    else if (version !== undefined) {
      const found = await findVersion(actor, existing.templateId, version);
      if (!found) return c.json({ error: "Template version not found" }, 404);
      templateVersionId = found.version.id;
    }
    const filled =
      prefill || lockedKeys ? await linkVersion(db, existing.templateId, templateVersionId) : null;
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(shareLink)
        .set({
          ...options,
          templateVersionId,
          ...(disabled !== undefined ? { disabledAt: disabled ? new Date() : null } : {}),
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
          ...(filled
            ? cleanPrefill(
                filled.sections,
                prefill ?? existing.prefill,
                lockedKeys ?? existing.lockedKeys,
              )
            : {}),
        })
        .where(eq(shareLink.id, id))
        .returning();
      if (!updated) return undefined;
      await recordAudit(
        {
          action: "share_link.updated",
          target: { id, name: updated.label },
          before: existing,
          after: updated,
          sections: (filled ?? (await linkVersion(tx, existing.templateId, templateVersionId)))
            ?.sections,
        },
        tx,
      );
      return { id };
    });
    return c.json(row, 200);
  })
  .delete("/:id", canPublish, idParam, async (c) => {
    // Its submissions stay: they're the owner's documents.
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(shareLink)
        .where(own(c.get("user").id, c.req.valid("param").id))
        .returning();
      if (row) {
        const version = await linkVersion(tx, row.templateId, row.templateVersionId);
        await recordAudit(
          {
            action: "share_link.deleted",
            target: { id: row.id, name: row.label },
            before: row,
            sections: version?.sections,
          },
          tx,
        );
      }
      return row;
    });
    return deleted ? c.body(null, 204) : c.json({ error: "Share link not found" }, 404);
  })
  .get("/:id", canPublish, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = c.get("user").id;
    const [link] = await selectLinks().where(own(ownerId, id));
    if (!link) return c.json({ error: "Share link not found" }, 404);
    const submissions = await selectSubmissions().where(
      and(eq(submission.ownerId, ownerId), eq(submission.shareLinkId, id)),
    );
    // Opening the responses is what marks them seen.
    await db.update(shareLink).set({ seenAt: new Date() }).where(eq(shareLink.id, id));
    return c.json({ link, submissions }, 200);
  });

// ---------------------------------------------------------------------------------------------
// Public

/** The link, the version it fills, and why it refuses if it does. Locks the link row in a tx. */
async function openLink(tx: Tx, token: string, lock: boolean) {
  const query = tx
    .select({ link: shareLink, archivedAt: template.archivedAt })
    .from(shareLink)
    .innerJoin(template, eq(template.id, shareLink.templateId))
    .where(eq(shareLink.token, token));
  const [row] = await (lock ? query.for("update", { of: shareLink }) : query);
  if (!row) return null;
  const { link } = row;
  const [used] = await tx
    .select({ count: count() })
    .from(submission)
    .where(eq(submission.shareLinkId, link.id));
  const unavailable: ShareLinkUnavailable | null = link.disabledAt
    ? "disabled"
    : link.expiresAt && link.expiresAt <= new Date()
      ? "expired"
      : link.maxSubmissions !== null && (used?.count ?? 0) >= link.maxSubmissions
        ? "used_up"
        : row.archivedAt
          ? "archived"
          : null;
  const version = await linkVersion(tx, link.templateId, link.templateVersionId);
  return { link, unavailable, version };
}

const unavailableResponse = (c: Context, reason: ShareLinkUnavailable) =>
  c.json({ error: "This link is no longer available", reason }, 410);

/** The socket's address, or the last X-Forwarded-For hop (the proxy's own) with TRUST_PROXY. */
function clientAddress(c: Context) {
  const hops = env.TRUST_PROXY ? c.req.header("X-Forwarded-For")?.split(",") : undefined;
  return hops?.at(-1)?.trim() || getConnInfo(c).remote.address || "unknown";
}

export const publicShareRoutes = new Hono<AppEnv>()
  .get("/:token", tokenParam, async (c) => {
    const opened = await openLink(db, c.req.valid("param").token, false);
    if (!opened?.version) return c.json({ error: "This link doesn't exist" }, 404);
    const { link, unavailable, version } = opened;
    if (unavailable) return unavailableResponse(c, unavailable);
    await db
      .update(shareLink)
      // A view isn't an edit: keep updatedAt.
      .set({ views: sql`${shareLink.views} + 1`, updatedAt: link.updatedAt })
      .where(eq(shareLink.id, link.id));
    return c.json(
      {
        label: link.label,
        name: version.name,
        description: version.description,
        sections: version.sections,
        prefill: link.prefill,
        lockedKeys: link.lockedKeys,
        requireEmail: link.requireEmail,
        allowDownload: link.allowDownload,
        ...versionLocalization(version),
      },
      200,
    );
  })
  .post("/:token", tokenParam, zValidator("json", shareSubmitSchema), async (c) => {
    const limited = submitLimit.take(clientAddress(c));
    if (!limited.ok) {
      c.header("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
      return c.json({ error: "Too many submissions; try again in a minute" }, 429);
    }
    const body = c.req.valid("json");
    // The link row stays locked until the insert commits, so max submissions holds under races.
    const outcome = await db.transaction(async (tx) => {
      const opened = await openLink(tx, c.req.valid("param").token, true);
      if (!opened?.version) return { kind: "missing" } as const;
      const { link, unavailable, version } = opened;
      if (unavailable) return { kind: "unavailable", reason: unavailable } as const;
      if (link.requireEmail && !body.email) return { kind: "email" } as const;
      // Locked answers come from the link, whatever the request says.
      const locked = Object.fromEntries(
        link.lockedKeys.flatMap((key) =>
          Object.hasOwn(link.prefill, key) ? [[key, link.prefill[key]]] : [],
        ),
      );
      const data = { ...fieldAnswers(version.sections, body.data), ...locked };
      const parsed = templateDataSchema(version.sections).safeParse(data);
      if (!parsed.success) return { kind: "invalid", errors: fieldErrors(parsed.error) } as const;
      const [row] = await tx
        .insert(submission)
        .values({
          ownerId: link.ownerId,
          templateId: link.templateId,
          templateVersionId: version.id,
          name: `${version.name} (${link.label})`,
          source: "share_link",
          shareLinkId: link.id,
          respondentEmail: body.email ?? null,
          locale: body.locale ?? null,
          data,
        })
        .returning();
      if (!row) throw new Error("Submission insert returned no row");
      return { kind: "created", row, link, version } as const;
    });
    switch (outcome.kind) {
      case "missing":
        return c.json({ error: "This link doesn't exist" }, 404);
      case "unavailable":
        return unavailableResponse(c, outcome.reason);
      case "email":
        return c.json({ error: "Enter your email address" }, 422);
      case "invalid":
        return c.json({ error: "Some answers need fixing", fieldErrors: outcome.errors }, 422);
    }
    const { row, link, version } = outcome;
    const finished = await finishSubmission({
      row,
      version,
      source: "share_link",
      requestId: c.get("requestId"),
      wait: true,
    });
    const status = finished.ok ? finished.result.status : "error";
    let downloadUrl: string | null = null;
    if (finished.ok && finished.result.status === "success" && link.allowDownload) {
      const { url } = await mintLink({
        fileId: finished.result.fileId,
        generationId: finished.result.generationId,
        userId: link.ownerId,
        expiresInSeconds: DOWNLOAD_SECONDS,
      });
      downloadUrl = url;
    }
    return c.json({ status, downloadUrl }, 201);
  });
