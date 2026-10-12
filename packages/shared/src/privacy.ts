import { z } from "zod";
import type { Field, FieldSection } from "./fields";
import { generationSourceSchema, generationStatusSchema } from "./generation";
import { submissionStatusSchema } from "./submission";

// Spec: docs/features/personal-data-masking-and-erasure.md, ADR 0039. Values stay whole in stored
// inputs and PDFs; this is what everything else shows instead.

export const MASKED = "[masked]";

/** Keys that hold an id, tax number, birth date or account number, as snake_case words. */
const SENSITIVE_KEY =
  /(^|_)(ssn|sin|tin|ein|nino|tax_?id|tax_?number|passport(_number)?|dob|birth_?date|date_of_birth|iban|bank_account|account_number|card_number|credit_card|cvv|cvc|routing_number|licen[cs]e_number|health_card|national_id)(_|$)/;

const sensitiveKey = (key: string) => SENSITIVE_KEY.test(key);

/** An explicit flag wins; unset means signatures and keys that look like ids or account numbers. */
export const isSensitiveField = (field: Pick<Field, "key" | "type" | "sensitive">) =>
  field.sensitive ?? (field.type === "signature" || sensitiveKey(field.key));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keys without a field definition (HTML API data): sensitive by key, all the way down. */
function maskByKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskByKey);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, sensitiveKey(key) ? MASKED : maskByKey(v)]),
  );
}

function maskFields(data: Record<string, unknown>, fields: readonly Field[]) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      const field = byKey.get(key);
      if (!field) return [key, sensitiveKey(key) ? MASKED : maskByKey(value)];
      if (isSensitiveField(field)) return [key, MASKED];
      if (field.type === "group" && Array.isArray(value)) {
        return [key, value.map((item) => (isRecord(item) ? maskFields(item, field.fields) : item))];
      }
      return [key, value];
    }),
  );
}

/** Data with sensitive values replaced by MASKED. Without fields, only keys decide. */
export const maskData = (
  data: Record<string, unknown>,
  sections: readonly FieldSection[] | null | undefined,
): Record<string, unknown> =>
  sections
    ? maskFields(
        data,
        sections.flatMap((s) => s.fields),
      )
    : (maskByKey(data) as Record<string, unknown>);

/** Every string and number in a value, as text. */
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) leaves(v, out);
  else if (isRecord(value)) for (const v of Object.values(value)) leaves(v, out);
  return out;
}

/**
 * Text (an error message) with every value of `data` in it replaced by MASKED, for logs and spans,
 * which never carry field values. Values under 3 characters are left: they'd mask ordinary words.
 */
export function scrubValues(text: string, data: unknown) {
  const values = [...new Set(leaves(data))].filter((v) => v.length >= 3);
  // Longest first, so a value containing another is masked whole.
  values.sort((a, b) => b.length - a.length);
  let scrubbed = text;
  for (const value of values) scrubbed = scrubbed.replaceAll(value, MASKED);
  return scrubbed;
}

// ---------------------------------------------------------------------------------------------
// Data subjects

/** Who a document is about (an email, a customer number), so an erasure can find it. */
export const subjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .meta({ description: "Who the document is about (an email, a customer number), for erasure." });

/** An exact value, compared case-insensitively. Three characters or more. */
export const subjectSearchSchema = z.object({
  q: z.string().trim().min(3, "Enter at least 3 characters").max(200),
});

export const subjectGenerationSchema = z.object({
  id: z.uuid(),
  source: generationSourceSchema,
  status: generationStatusSchema,
  filename: z.string(),
  templateName: z.string().nullable(),
  userName: z.string().nullable(),
  subject: z.string().nullable(),
  queuedAt: z.iso.datetime(),
  /** The subject key, a stored value, or a packet built from a matching generation. */
  matchedBy: z.enum(["subject", "value", "packet"]),
});
export type SubjectGeneration = z.infer<typeof subjectGenerationSchema>;

export const subjectSubmissionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: submissionStatusSchema,
  ownerName: z.string().nullable(),
  respondentEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
  matchedBy: z.enum(["respondent_email", "value"]),
});
export type SubjectSubmission = z.infer<typeof subjectSubmissionSchema>;

export const subjectMatchesSchema = z.object({
  generations: z.array(subjectGenerationSchema),
  submissions: z.array(subjectSubmissionSchema),
  /** More matched than are listed; erase these, then search again. */
  truncated: z.boolean(),
});
export type SubjectMatches = z.infer<typeof subjectMatchesSchema>;

/** Erases the listed matches of `q`; ids that no longer match it are skipped. */
export const erasureRequestSchema = subjectSearchSchema
  .extend({
    generationIds: z.array(z.uuid()).max(1000).default([]),
    submissionIds: z.array(z.uuid()).max(1000).default([]),
  })
  .refine((r) => r.generationIds.length + r.submissionIds.length > 0, {
    message: "Pick at least one match to erase",
  });
export type ErasureRequest = z.input<typeof erasureRequestSchema>;

export const erasureReportSchema = z.object({
  erasedAt: z.iso.datetime(),
  generationIds: z.array(z.uuid()),
  submissionIds: z.array(z.uuid()),
  files: z.int(),
  webhookDeliveries: z.int(),
  downloadLinks: z.int(),
  /** Stored objects the storage driver failed to delete (their rows are gone). */
  objectsLeftBehind: z.int(),
});
export type ErasureReport = z.infer<typeof erasureReportSchema>;
