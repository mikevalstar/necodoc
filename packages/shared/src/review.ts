import { z } from "zod";

// Spec: docs/features/review-and-approval.md

export const reviewStatusSchema = z.enum([
  "pending",
  "changes_requested",
  "approved",
  "published",
  "withdrawn",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
/** A review the editor and reviewers still act on; at most one per template. */
export const openReviewStatuses = [
  "pending",
  "changes_requested",
  "approved",
] as const satisfies readonly ReviewStatus[];

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: "Waiting for review",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  withdrawn: "Withdrawn",
};

/** One entry in a review's thread: a comment, or a state change with its optional comment. */
export const reviewEventKindSchema = z.enum([
  "submitted",
  "resubmitted",
  "comment",
  "changes_requested",
  "approved",
  "published",
  "withdrawn",
]);
export type ReviewEventKind = z.infer<typeof reviewEventKindSchema>;

/** Admin › System › Publishing. Every flag is off by default. */
export const publishingSettingsSchema = z.object({
  requireReview: z.boolean().default(false),
  allowSelfApproval: z.boolean().default(false),
  blockOnFailingTests: z.boolean().default(false),
});
export type PublishingSettings = z.infer<typeof publishingSettingsSchema>;

const comment = z.string().trim().max(5000);

export const submitReviewSchema = z.object({
  templateId: z.uuid(),
  note: comment.optional(),
});

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), comment: comment.optional() }),
  z.object({
    decision: z.literal("request_changes"),
    comment: comment.min(1, "Say what needs to change"),
  }),
]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const reviewCommentSchema = z.object({ body: comment.min(1, "Write a comment") });

export const reviewListQuerySchema = z.object({
  /** open: pending, changes requested or approved. */
  status: z.enum(["open", "all"]).default("open"),
  templateId: z.uuid().optional(),
});

// Notifications (bell in the nav)

export const notificationKindSchema = z.enum([
  "review_requested",
  "changes_requested",
  "approved",
  "published",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const markNotificationsReadSchema = z.object({
  /** Omit to mark every notification read. */
  ids: z.array(z.uuid()).max(200).optional(),
});
