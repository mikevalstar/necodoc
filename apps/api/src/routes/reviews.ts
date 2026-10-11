import { zValidator } from "@hono/zod-validator";
import {
  openReviewStatuses,
  reviewCommentSchema,
  reviewDecisionSchema,
  reviewListQuerySchema,
  submitReviewSchema,
} from "@necodoc/shared";
import { and, asc, desc, eq, inArray, max, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { template, templateReview, templateReviewEvent, templateVersion, user } from "../db/schema";
import { type AppEnv, requireAnyPermission, requirePermission } from "../middleware";
import { publishSnapshot } from "../publish";
import { notify, publishingSettings, usersWith } from "../review";
import { draftAccess, findDraft } from "./templates";

// Spec: docs/features/review-and-approval.md. Editors submit; reviewers approve or request
// changes; publishers publish (routes/templates.ts checks the approval when it's required).

const canSeeDrafts = requireAnyPermission(...draftAccess);
const canEdit = requirePermission({ document: ["edit"] });
const canReview = requirePermission({ document: ["review"] });

const idParam = zValidator("param", z.object({ id: z.uuid() }));
const templateParam = zValidator("param", z.object({ templateId: z.uuid() }));

const submitter = alias(user, "submitter");
const decider = alias(user, "decider");
const author = alias(user, "author");
const open = inArray(templateReview.status, [...openReviewStatuses]);

function selectReviews(where: SQL | undefined) {
  return db
    .select({
      id: templateReview.id,
      templateId: templateReview.templateId,
      templateName: template.name,
      templateKind: template.kind,
      status: templateReview.status,
      note: templateReview.note,
      baseVersion: templateReview.baseVersion,
      submittedBy: templateReview.submittedBy,
      submitterName: submitter.name,
      submittedAt: templateReview.submittedAt,
      decidedBy: templateReview.decidedBy,
      deciderName: decider.name,
      decidedAt: templateReview.decidedAt,
      publishedVersion: templateVersion.version,
      fingerprint: templateReview.fingerprint,
    })
    .from(templateReview)
    .innerJoin(template, eq(template.id, templateReview.templateId))
    .leftJoin(submitter, eq(submitter.id, templateReview.submittedBy))
    .leftJoin(decider, eq(decider.id, templateReview.decidedBy))
    .leftJoin(templateVersion, eq(templateVersion.id, templateReview.templateVersionId))
    .where(where);
}
type ReviewRow = Awaited<ReturnType<typeof selectReviews>>[number];

/** Each template's current fingerprint, or why it can't be published (and so reviewed). */
async function currentFingerprints(templateIds: readonly string[]) {
  const out = new Map<string, { fingerprint: string } | { error: string }>();
  for (const id of new Set(templateIds)) {
    const draft = await findDraft(id);
    const built = draft ? await publishSnapshot(draft) : { error: "Template not found" };
    out.set(
      id,
      built.fingerprint
        ? { fingerprint: built.fingerprint }
        : { error: built.error ?? "It can't be published" },
    );
  }
  return out;
}

/**
 * Open reviews are stale once the draft (or its theme or snippets) moved on since submission.
 * Closed ones are history and never stale. The fingerprint itself stays on the server.
 */
async function withStale(rows: ReviewRow[]) {
  const current = await currentFingerprints(
    rows.filter((r) => isOpen(r.status)).map((r) => r.templateId),
  );
  return rows.map(({ fingerprint, ...row }) => {
    const now = isOpen(row.status) ? current.get(row.templateId) : undefined;
    const stale = now ? !("fingerprint" in now) || now.fingerprint !== fingerprint : false;
    const staleReason = now && "error" in now ? now.error : null;
    return { ...row, stale, staleReason };
  });
}

const isOpen = (status: ReviewRow["status"]) =>
  (openReviewStatuses as readonly string[]).includes(status);

async function findReview(id: string) {
  const [row] = await withStale(await selectReviews(eq(templateReview.id, id)));
  return row ?? null;
}

async function latestVersion(templateId: string) {
  const [row] = await db
    .select({ version: max(templateVersion.version) })
    .from(templateVersion)
    .where(eq(templateVersion.templateId, templateId));
  return row?.version ?? null;
}

export const reviewRoutes = new Hono<AppEnv>()
  .get("/", canSeeDrafts, zValidator("query", reviewListQuerySchema), async (c) => {
    const { status, templateId } = c.req.valid("query");
    const rows = await selectReviews(
      and(
        status === "open" ? open : undefined,
        templateId ? eq(templateReview.templateId, templateId) : undefined,
      ),
    ).orderBy(
      status === "open" ? asc(templateReview.submittedAt) : desc(templateReview.submittedAt),
    );
    return c.json(await withStale(rows), 200);
  })
  .post("/", canEdit, zValidator("json", submitReviewSchema), async (c) => {
    const { templateId, note } = c.req.valid("json");
    const actor = c.get("user");
    const draft = await findDraft(templateId);
    if (!draft) return c.json({ error: "Template not found" }, 404);
    if (draft.archivedAt) return c.json({ error: "Restore the template first" }, 409);
    const built = await publishSnapshot(draft);
    if (!built.fingerprint) {
      return c.json({ error: `It can't be published as it is: ${built.error}` }, 422);
    }
    const baseVersion = await latestVersion(templateId);
    const reviewers = await usersWith("review", actor.id);
    const id = await db.transaction(async (tx) => {
      const values = {
        status: "pending" as const,
        fingerprint: built.fingerprint,
        baseVersion,
        note: note || null,
        submittedBy: actor.id,
        submittedAt: new Date(),
        decidedBy: null,
        decidedAt: null,
      };
      const [reopened] = await tx
        .update(templateReview)
        .set(values)
        .where(and(eq(templateReview.templateId, templateId), open))
        .returning({ id: templateReview.id });
      const [review] = reopened
        ? [reopened]
        : await tx
            .insert(templateReview)
            .values({ ...values, templateId })
            .returning({ id: templateReview.id });
      if (!review) throw new Error("Review insert returned no row");
      await tx.insert(templateReviewEvent).values({
        reviewId: review.id,
        kind: reopened ? "resubmitted" : "submitted",
        body: note || null,
        authorId: actor.id,
      });
      // TODO(audit-log): record "template.review.submitted" { reviewId, templateId, resubmitted }.
      await notify(tx, reviewers, {
        kind: "review_requested",
        message: `${actor.name} asked for a review${note ? `: ${note.slice(0, 140)}` : ""}`,
        actorId: actor.id,
        templateId,
        reviewId: review.id,
      });
      return review.id;
    });
    return c.json(await findReview(id), 201);
  })
  // The template page and publish dialog: settings, the open review and the history.
  .get("/templates/:templateId", canSeeDrafts, templateParam, async (c) => {
    const { templateId } = c.req.valid("param");
    const [settings, history] = await Promise.all([
      publishingSettings(),
      selectReviews(eq(templateReview.templateId, templateId))
        .orderBy(desc(templateReview.submittedAt))
        .then(withStale),
    ]);
    const current = history.find((r) => isOpen(r.status)) ?? null;
    return c.json(
      {
        settings,
        current,
        /** Publish would pass the review gate now. */
        approved: current?.status === "approved" && !current.stale,
        history,
      },
      200,
    );
  })
  .get("/:id", canSeeDrafts, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const review = await findReview(id);
    if (!review) return c.json({ error: "Review not found" }, 404);
    const [events, settings, latest] = await Promise.all([
      db
        .select({
          id: templateReviewEvent.id,
          kind: templateReviewEvent.kind,
          body: templateReviewEvent.body,
          authorId: templateReviewEvent.authorId,
          authorName: author.name,
          createdAt: templateReviewEvent.createdAt,
        })
        .from(templateReviewEvent)
        .leftJoin(author, eq(author.id, templateReviewEvent.authorId))
        .where(eq(templateReviewEvent.reviewId, id))
        .orderBy(asc(templateReviewEvent.createdAt)),
      publishingSettings(),
      latestVersion(review.templateId),
    ]);
    return c.json({ ...review, latestVersion: latest, events, settings }, 200);
  })
  .post(
    "/:id/decision",
    canReview,
    idParam,
    zValidator("json", reviewDecisionSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const actor = c.get("user");
      const review = await findReview(id);
      if (!review) return c.json({ error: "Review not found" }, 404);
      const settings = await publishingSettings();
      if (review.submittedBy === actor.id && !settings.allowSelfApproval) {
        return c.json({ error: "You can't decide on a review you submitted" }, 403);
      }
      const approve = body.decision === "approve";
      const allowed = approve ? review.status === "pending" : review.status !== "changes_requested";
      if (!allowed || !isOpen(review.status)) {
        return c.json({ error: `This review is ${review.status.replace("_", " ")}` }, 409);
      }
      if (approve && review.stale) {
        return c.json(
          { error: "The draft changed since it was submitted; ask for it to be resubmitted" },
          409,
        );
      }
      const status = approve ? "approved" : "changes_requested";
      // Approval also tells publishers it's ready.
      const recipients = [
        review.submittedBy,
        ...(approve ? await usersWith("publish", actor.id) : []),
      ];
      const decided = await db.transaction(async (tx) => {
        // Guarded on the status read above, so two reviewers deciding at once can't both win.
        const [row] = await tx
          .update(templateReview)
          .set({ status, decidedBy: actor.id, decidedAt: new Date() })
          .where(and(eq(templateReview.id, id), eq(templateReview.status, review.status)))
          .returning({ id: templateReview.id });
        if (!row) return false;
        await tx
          .insert(templateReviewEvent)
          .values({ reviewId: id, kind: status, body: body.comment || null, authorId: actor.id });
        // TODO(audit-log): record "template.review.approved" / "template.review.changes_requested".
        await notify(tx, recipients, {
          kind: status,
          message: approve
            ? `${actor.name} approved it${body.comment ? `: ${body.comment.slice(0, 140)}` : ""}`
            : `${actor.name} requested changes: ${body.comment?.slice(0, 140) ?? ""}`,
          actorId: actor.id,
          templateId: review.templateId,
          reviewId: id,
        });
        return true;
      });
      if (!decided) return c.json({ error: "Someone decided on this review just now" }, 409);
      return c.json(await findReview(id), 200);
    },
  )
  .post(
    "/:id/comments",
    canSeeDrafts,
    idParam,
    zValidator("json", reviewCommentSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const [review] = await db
        .select({ id: templateReview.id })
        .from(templateReview)
        .where(eq(templateReview.id, id));
      if (!review) return c.json({ error: "Review not found" }, 404);
      const [event] = await db
        .insert(templateReviewEvent)
        .values({
          reviewId: id,
          kind: "comment",
          body: c.req.valid("json").body,
          authorId: c.get("user").id,
        })
        .returning();
      return c.json(event, 201);
    },
  )
  .post("/:id/withdraw", canEdit, idParam, async (c) => {
    const { id } = c.req.valid("param");
    const actor = c.get("user");
    const [withdrawn] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(templateReview)
        .set({ status: "withdrawn" })
        .where(and(eq(templateReview.id, id), open))
        .returning({ id: templateReview.id });
      if (rows.length) {
        await tx
          .insert(templateReviewEvent)
          .values({ reviewId: id, kind: "withdrawn", authorId: actor.id });
        // TODO(audit-log): record "template.review.withdrawn" { reviewId }.
      }
      return rows;
    });
    if (!withdrawn) return c.json({ error: "No open review with that id" }, 404);
    return c.json(await findReview(id), 200);
  });
