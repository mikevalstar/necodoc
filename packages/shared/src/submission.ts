import { z } from "zod";

// Specs: docs/features/filling-out-a-document.md (documents),
// docs/features/share-links-and-data-requests.md (share links). A submission is one document
// being filled: its answers, pinned to a published template version.

export const submissionStatusSchema = z.enum(["draft", "finished"]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** Filled in the app by its owner, or by someone outside through a share link. */
export const submissionSourceSchema = z.enum(["app", "share_link"]);
export type SubmissionSource = z.infer<typeof submissionSourceSchema>;

/** Answers as the form holds them. Drafts are only checked for shape; finish checks the fields. */
const answers = z.record(z.string(), z.unknown());

const documentName = z.string().trim().min(1, "Enter a name").max(200);

/** POST /submissions: a new draft on a published version (the latest unless one is given). */
export const createSubmissionSchema = z.object({
  templateId: z.uuid(),
  version: z.int().positive().optional(),
  /** Start from a previous document's answers: fields with the same key carry over. */
  fromSubmissionId: z.uuid().optional(),
  name: documentName.optional(),
});
export type CreateSubmission = z.infer<typeof createSubmissionSchema>;

/** PATCH /submissions/:id (autosave). Changing the answers of a finished document reopens it. */
export const updateSubmissionSchema = z.object({
  data: answers.optional(),
  /** The guided-form step the user was on, so a reload reopens there. */
  step: z.int().min(0).max(1000).optional(),
  name: documentName.optional(),
});
export type UpdateSubmission = z.infer<typeof updateSubmissionSchema>;

/** POST /submissions/:id/finish: optionally the last answers, saved first, then generated. */
export const finishSubmissionSchema = z.object({ data: answers.optional() });

export const submissionListQuerySchema = z.object({
  status: submissionStatusSchema.optional(),
  source: submissionSourceSchema.optional(),
  shareLinkId: z.uuid().optional(),
});
export type SubmissionListQuery = z.infer<typeof submissionListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Share links

const dateTime = z.iso.datetime({ offset: true });

const shareLinkOptions = {
  label: z.string().trim().min(1, "Enter a label").max(200),
  /** Null follows the latest published version. */
  version: z.int().positive().nullable(),
  expiresAt: dateTime.nullable(),
  /** 1 for a single-use request; null for no limit. */
  maxSubmissions: z.int().min(1).max(100_000).nullable(),
  requireEmail: z.boolean(),
  allowDownload: z.boolean(),
  /** Answers the filler starts with. */
  prefill: answers,
  /** Prefilled top-level fields the filler can't change; the API enforces it. */
  lockedKeys: z.array(z.string().max(64)).max(500),
};

export const createShareLinkSchema = z.object({
  templateId: z.uuid(),
  ...shareLinkOptions,
  version: shareLinkOptions.version.default(null),
  expiresAt: shareLinkOptions.expiresAt.default(null),
  maxSubmissions: shareLinkOptions.maxSubmissions.default(null),
  requireEmail: shareLinkOptions.requireEmail.default(false),
  allowDownload: shareLinkOptions.allowDownload.default(true),
  prefill: shareLinkOptions.prefill.default({}),
  lockedKeys: shareLinkOptions.lockedKeys.default([]),
});
export type CreateShareLink = z.infer<typeof createShareLinkSchema>;

/** PATCH /share-links/:id: any option, and `disabled` to revoke or re-enable. */
export const updateShareLinkSchema = z
  .object({ ...shareLinkOptions, disabled: z.boolean() })
  .partial();
export type UpdateShareLink = z.infer<typeof updateShareLinkSchema>;

/** Why a public link refuses: the page says "no longer available" for each. */
export const shareLinkUnavailableSchema = z.enum(["disabled", "expired", "used_up", "archived"]);
export type ShareLinkUnavailable = z.infer<typeof shareLinkUnavailableSchema>;

/** POST /share/:token: what the filler sends. */
export const shareSubmitSchema = z.object({
  data: answers,
  email: z.email().max(320).optional(),
});
export type ShareSubmit = z.infer<typeof shareSubmitSchema>;

/**
 * Answers for this version's top-level fields only. Drafts keep nothing else, and reusing a
 * previous document carries over the fields whose keys match.
 */
export function fieldAnswers(
  sections: readonly { fields: readonly { key: string }[] }[],
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const keys = new Set(sections.flatMap((section) => section.fields.map((field) => field.key)));
  return Object.fromEntries(Object.entries(data).filter(([key]) => keys.has(key)));
}
