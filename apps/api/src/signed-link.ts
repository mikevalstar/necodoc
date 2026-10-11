import { createHmac, timingSafeEqual } from "node:crypto";

// Spec: docs/features/generation-log.md (signed links), ADR 0023. A token names one file and an
// expiry and is HMAC-signed, so checking it needs no lookup. The link id ties a use back to the
// download_link row that records who minted it.

export type LinkClaims = { fileId: string; linkId: string /** Unix seconds. */; expiresAt: number };

export type LinkCheck =
  | { ok: true; claims: LinkClaims }
  | { ok: false; reason: "invalid" | "expired" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAYLOAD = new RegExp(`^(${UUID}):(${UUID}):(\\d{1,12})$`);

/** Domain-separated, so the secret's other uses (Better Auth) can't produce a valid signature. */
const signature = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(`necodoc-download-link:v1:${payload}`).digest();

export function signLink({ fileId, linkId, expiresAt }: LinkClaims, secret: string) {
  const payload = `${fileId}:${linkId}:${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyLink(token: string, secret: string, now = Date.now()): LinkCheck {
  const [encoded = "", sent = "", ...rest] = token.split(".");
  if (rest.length) return { ok: false, reason: "invalid" };
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = signature(payload, secret);
  const given = Buffer.from(sent, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  const match = payload.match(PAYLOAD);
  if (!match?.[1] || !match[2] || !match[3]) return { ok: false, reason: "invalid" };
  const claims = { fileId: match[1], linkId: match[2], expiresAt: Number(match[3]) };
  if (claims.expiresAt * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
