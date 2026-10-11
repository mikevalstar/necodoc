import {
  hasPermission,
  type NotificationKind,
  openReviewStatuses,
  type PublishingSettings,
  parseRoles,
  publishingSettingsSchema,
} from "@necodoc/shared";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { notification, setting, templateReview, templateReviewEvent, user } from "./db/schema";
import type { Tx } from "./generate";

// Spec: docs/features/review-and-approval.md. Settings, the publish gate and notifications.

export async function publishingSettings(): Promise<PublishingSettings> {
  const [row] = await db.select().from(setting).where(eq(setting.key, "publishing"));
  return publishingSettingsSchema.parse(row?.value ?? {});
}

export async function savePublishingSettings(value: PublishingSettings, userId: string) {
  await db
    .insert(setting)
    .values({ key: "publishing", value, updatedBy: userId })
    .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: userId } });
}

/** The approved review this exact draft (by fingerprint) may be published under, if any. */
export async function approvedReview(templateId: string, fingerprint: string) {
  const [row] = await db
    .select({ id: templateReview.id })
    .from(templateReview)
    .where(
      and(
        eq(templateReview.templateId, templateId),
        eq(templateReview.status, "approved"),
        eq(templateReview.fingerprint, fingerprint),
      ),
    );
  return row ?? null;
}

/** Everyone who can act on a review request: `document: review`, active, not a service account. */
export async function reviewerIds(except: string | null) {
  // Roles are a comma-separated column; the user base is small enough to filter here.
  const rows = await db
    .select({ id: user.id, role: user.role, banned: user.banned, service: user.serviceAccount })
    .from(user);
  return rows
    .filter((row) => row.id !== except && !row.banned && !row.service)
    .filter((row) => hasPermission(parseRoles(row.role), { document: ["review"] }))
    .map((row) => row.id);
}

type Notice = {
  kind: NotificationKind;
  message: string;
  actorId: string;
  templateId: string;
  reviewId: string;
};

/** One notification per recipient, never to the actor themselves. */
export async function notify(tx: Tx, recipients: readonly (string | null)[], notice: Notice) {
  const ids = [...new Set(recipients)].filter(
    (id): id is string => id !== null && id !== notice.actorId,
  );
  if (ids.length)
    await tx.insert(notification).values(ids.map((userId) => ({ userId, ...notice })));
}

/**
 * After a publish: the template's open review of this exact draft (by fingerprint), if any,
 * becomes published and points at the version. Its submitter and approver are told.
 */
export async function closeReviewAsPublished(
  tx: Tx,
  p: {
    templateId: string;
    fingerprint: string;
    actorId: string;
    version: number;
    versionId: string;
  },
) {
  const [review] = await tx
    .update(templateReview)
    .set({ status: "published", templateVersionId: p.versionId })
    .where(
      and(
        eq(templateReview.templateId, p.templateId),
        eq(templateReview.fingerprint, p.fingerprint),
        inArray(templateReview.status, [...openReviewStatuses]),
      ),
    )
    .returning();
  if (!review) return null;
  await tx
    .insert(templateReviewEvent)
    .values({
      reviewId: review.id,
      kind: "published",
      body: `Version ${p.version}`,
      authorId: p.actorId,
    });
  // TODO(audit-log): record "template.review.published" { reviewId, templateId, version }.
  await notify(tx, [review.submittedBy, review.decidedBy], {
    kind: "published",
    message: `Published as version ${p.version}`,
    actorId: p.actorId,
    templateId: p.templateId,
    reviewId: review.id,
  });
  return review;
}
