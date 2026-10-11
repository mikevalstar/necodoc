import { createHmac, randomBytes } from "node:crypto";

// Spec: docs/features/webhooks.md. Signing and matching, kept free of env and the database so
// they're unit-tested (webhook-rules.test.ts). The developer docs show receivers this signature.

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

/** Hex HMAC-SHA256 of `${timestamp}.${body}`, as receivers recompute it. */
export const webhookSignature = (secret: string, timestamp: number, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export const signatureHeader = (secret: string, body: string, now = Date.now()) => {
  const timestamp = Math.floor(now / 1000);
  return `t=${timestamp},v1=${webhookSignature(secret, timestamp, body)}`;
};

export type WebhookScope = { ownerId: string; apiKeyId: string | null; templateId: string | null };
export type WebhookSubject = {
  userId: string | null;
  apiKeyId: string | null;
  templateId: string | null;
};

/**
 * Key and template filters must each match when set. A webhook with neither fires for its
 * owner's API calls (any key); a template filter alone fires for every source.
 */
export function webhookMatches(w: WebhookScope, s: WebhookSubject) {
  if (w.apiKeyId && w.apiKeyId !== s.apiKeyId) return false;
  if (w.templateId && w.templateId !== s.templateId) return false;
  if (w.apiKeyId || w.templateId) return true;
  return s.apiKeyId !== null && w.ownerId === s.userId;
}
