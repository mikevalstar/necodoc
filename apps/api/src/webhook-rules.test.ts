import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signatureHeader, webhookMatches } from "./webhook-rules";

describe("signatureHeader", () => {
  it('signs "<t>.<body>" with HMAC-SHA256, as the docs tell receivers', () => {
    const body = '{"event":"webhook.test"}';
    const header = signatureHeader("whsec_test", body, 1_700_000_000_500);
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
    expect(header).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe("webhookMatches", () => {
  const apiCall = { userId: "svc", apiKeyId: "key-1", templateId: "tpl-1" };

  it("an account webhook fires for its own API calls only", () => {
    const hook = { ownerId: "svc", apiKeyId: null, templateId: null };
    expect(webhookMatches(hook, apiCall)).toBe(true);
    expect(webhookMatches(hook, { ...apiCall, apiKeyId: null })).toBe(false);
    expect(webhookMatches(hook, { ...apiCall, userId: "someone" })).toBe(false);
  });

  it("a key webhook fires for that key, narrowed by template when set", () => {
    expect(webhookMatches({ ownerId: "svc", apiKeyId: "key-1", templateId: null }, apiCall)).toBe(
      true,
    );
    expect(webhookMatches({ ownerId: "svc", apiKeyId: "key-2", templateId: null }, apiCall)).toBe(
      false,
    );
    expect(
      webhookMatches({ ownerId: "svc", apiKeyId: "key-1", templateId: "tpl-2" }, apiCall),
    ).toBe(false);
  });

  it("a template webhook fires for any source, any owner", () => {
    const hook = { ownerId: "editor", apiKeyId: null, templateId: "tpl-1" };
    expect(webhookMatches(hook, { userId: "anyone", apiKeyId: null, templateId: "tpl-1" })).toBe(
      true,
    );
    expect(webhookMatches(hook, { ...apiCall, templateId: "tpl-2" })).toBe(false);
  });
});
