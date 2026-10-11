import { z } from "zod";

// Spec: docs/features/webhooks.md

export const webhookEventSchema = z.enum([
  "generation.succeeded",
  "generation.failed",
  "batch.completed",
]);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

/** Sent by "send test"; nobody subscribes to it. */
export const WEBHOOK_TEST_EVENT = "webhook.test";

export const createWebhookSchema = z.object({
  url: z.url({ protocol: /^https?$/, error: "Enter a URL" }).max(2000),
  events: z.array(webhookEventSchema).min(1, "Pick at least one event"),
  /** Only generations made with this key. */
  apiKeyId: z.string().min(1).optional(),
  /** Only generations of this template (needs document: edit when it's the only filter). */
  templateId: z.uuid().optional(),
  /** A service account's id (admins only); omitted for your own. */
  ownerId: z.string().min(1).optional(),
  description: z.string().trim().max(200).default(""),
});
export type CreateWebhook = z.infer<typeof createWebhookSchema>;
export type CreateWebhookInput = z.input<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
});

export const webhookDeliveryStatusSchema = z.enum(["pending", "success", "failed"]);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

/** One POST: its outcome, as the delivery log shows it. */
export const webhookAttemptSchema = z.object({
  at: z.iso.datetime(),
  /** HTTP status; null when no response came back. */
  status: z.int().nullable(),
  ms: z.int(),
  error: z.string().nullable(),
});
export type WebhookAttempt = z.infer<typeof webhookAttemptSchema>;
