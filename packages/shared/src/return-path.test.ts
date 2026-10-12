import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeReturnPath("/admin/users")).toBe("/admin/users");
    expect(safeReturnPath("/templates/abc?tab=fields#x")).toBe("/templates/abc?tab=fields#x");
  });

  it("drops anything that could leave the site", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
    ]) {
      expect(safeReturnPath(value), value).toBeUndefined();
    }
  });

  it("drops home and the sign-in pages", () => {
    expect(safeReturnPath("/")).toBeUndefined();
    expect(safeReturnPath("/login?redirect=/x")).toBeUndefined();
    expect(safeReturnPath("/pending")).toBeUndefined();
    expect(safeReturnPath(undefined)).toBeUndefined();
  });
});
