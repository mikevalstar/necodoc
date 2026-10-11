import { describe, expect, it } from "vitest";
import { signLink, verifyLink } from "./signed-link";

const secret = "s".repeat(32);
const claims = {
  fileId: "3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6b",
  linkId: "9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e",
  expiresAt: 2_000_000_000,
};
const before = (claims.expiresAt - 1) * 1000;

describe("signed links", () => {
  it("round-trips its claims until expiry", () => {
    const token = signLink(claims, secret);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(verifyLink(token, secret, before)).toEqual({ ok: true, claims });
  });

  it("expires", () => {
    const token = signLink(claims, secret);
    expect(verifyLink(token, secret, claims.expiresAt * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects another secret, edits and junk", () => {
    const token = signLink(claims, secret);
    expect(verifyLink(token, "t".repeat(32), before).ok).toBe(false);
    const [, signature] = token.split(".");
    const forged = Buffer.from(`${claims.fileId}:${claims.linkId}:2100000000`).toString(
      "base64url",
    );
    expect(verifyLink(`${forged}.${signature}`, secret, before)).toEqual({
      ok: false,
      reason: "invalid",
    });
    for (const junk of ["", ".", "a.b.c", `${token}x`, token.replace(".", "")]) {
      expect(verifyLink(junk, secret, before).ok).toBe(false);
    }
  });
});
