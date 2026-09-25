import { describe, expect, it } from "vitest";
import { hasPermission, parseRoles } from "./roles";

describe("parseRoles", () => {
  it("parses Better Auth's comma list in role order", () => {
    expect(parseRoles("admin,editor")).toEqual(["admin", "editor"]);
    expect(parseRoles(" viewer , reviewer ")).toEqual(["reviewer", "viewer"]);
    expect(parseRoles("editor,admin")).toEqual(["admin", "editor"]);
  });

  it("returns no roles for empty values", () => {
    expect(parseRoles("")).toEqual([]);
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });

  it("drops unknown and duplicate roles", () => {
    expect(parseRoles("user,editor,editor,")).toEqual(["editor"]);
  });
});

describe("hasPermission", () => {
  it("combines permissions across roles", () => {
    expect(hasPermission(["editor", "publisher"], { document: ["create", "publish"] })).toBe(true);
    expect(hasPermission(["editor"], { document: ["create", "publish"] })).toBe(false);
  });

  it("keeps user management to admins", () => {
    expect(hasPermission(["admin"], { user: ["list", "set-role"] })).toBe(true);
    expect(hasPermission(["publisher", "reviewer", "editor", "viewer"], { user: ["list"] })).toBe(
      false,
    );
  });

  it("grants nothing without roles", () => {
    expect(hasPermission([], { document: ["view"] })).toBe(false);
  });
});
