import { describe, expect, it } from "vitest";
import { adminChange, adminGuardError, emailChangeTarget, selfDeleteError } from "./admin-guard";

describe("adminChange", () => {
  it("reads set-role roles as a list or a comma string", () => {
    expect(adminChange("/admin/set-role", { userId: "u", role: ["editor", "admin"] })).toEqual({
      targetId: "u",
      staysAdmin: true,
    });
    expect(adminChange("/admin/set-role", { userId: "u", role: "editor,viewer" })).toEqual({
      targetId: "u",
      staysAdmin: false,
    });
    expect(adminChange("/admin/set-role", { userId: "u", role: [] })).toEqual({
      targetId: "u",
      staysAdmin: false,
    });
  });

  it("treats ban and remove as losing admin", () => {
    const lost = { targetId: "u", staysAdmin: false };
    expect(adminChange("/admin/ban-user", { userId: "u" })).toEqual(lost);
    expect(adminChange("/admin/remove-user", { userId: "u" })).toEqual(lost);
  });

  it("guards update-user only when it bans or changes roles", () => {
    expect(adminChange("/admin/update-user", { userId: "u", data: { name: "x" } })).toBeNull();
    expect(adminChange("/admin/update-user", { userId: "u", data: { banned: true } })).toEqual({
      targetId: "u",
      staysAdmin: false,
    });
    expect(adminChange("/admin/update-user", { userId: "u", data: { role: "viewer" } })).toEqual({
      targetId: "u",
      staysAdmin: false,
    });
  });

  it("fails closed on update-user ban values other than false", () => {
    const lost = { targetId: "u", staysAdmin: false };
    expect(adminChange("/admin/update-user", { userId: "u", data: { banned: null } })).toEqual(
      lost,
    );
    expect(adminChange("/admin/update-user", { userId: "u", data: { banned: "true" } })).toEqual(
      lost,
    );
    expect(
      adminChange("/admin/update-user", { userId: "u", data: { role: "admin", banned: null } }),
    ).toEqual(lost);
    expect(
      adminChange("/admin/update-user", { userId: "u", data: { role: "admin", banned: false } }),
    ).toEqual({ targetId: "u", staysAdmin: true });
  });

  it("fails closed on role values or bodies it can't read", () => {
    const lost = { targetId: "u", staysAdmin: false };
    expect(adminChange("/admin/set-role", { userId: "u", role: "viewer", data: 1 })).toEqual(lost);
    expect(adminChange("/admin/set-role", { userId: "u", role: 1 })).toEqual(lost);
    expect(adminChange("/admin/set-role", { userId: "u" })).toEqual(lost);
    expect(adminChange("/admin/update-user", { userId: "u", data: { role: null } })).toEqual(lost);
    expect(adminChange("/admin/ban-user", undefined)).toBe("unreadable");
    expect(adminChange("/admin/update-user", { userId: "u", data: "x" })).toBe("unreadable");
  });

  it("allows update-user to change name and email", () => {
    expect(
      adminChange("/admin/update-user", { userId: "u", data: { name: "x", email: "x@y.z" } }),
    ).toBeNull();
  });

  it("ignores other paths", () => {
    expect(adminChange("/admin/unban-user", { userId: "u" })).toBeNull();
    expect(adminChange("/sign-up/email", { email: "a@b.c" })).toBeNull();
  });
});

describe("adminGuardError", () => {
  const demote = (targetId: string) => ({ targetId, staysAdmin: false });

  it("blocks admins from removing their own admin access", () => {
    expect(adminGuardError("a", demote("a"), new Set(["a", "b"]))).toMatch(/yourself/);
  });

  it("blocks removing the last active admin", () => {
    expect(adminGuardError("x", demote("a"), new Set(["a"]))).toMatch(/last admin/);
  });

  it("refuses bodies it can't read", () => {
    expect(adminGuardError("a", "unreadable", new Set(["a"]))).toMatch(/Invalid/);
  });

  it("allows changes that keep admin or touch non-admins", () => {
    expect(adminGuardError("a", { targetId: "a", staysAdmin: true }, new Set(["a"]))).toBeNull();
    expect(adminGuardError("a", demote("b"), new Set(["a", "b"]))).toBeNull();
    expect(adminGuardError("a", demote("c"), new Set(["a"]))).toBeNull();
  });
});

describe("selfDeleteError", () => {
  it("blocks the last active admin from deleting their own account", () => {
    expect(selfDeleteError("a", new Set(["a"]))).toMatch(/last admin/);
  });

  it("allows other admins and non-admins", () => {
    expect(selfDeleteError("a", new Set(["a", "b"]))).toBeNull();
    expect(selfDeleteError("c", new Set(["a"]))).toBeNull();
    expect(selfDeleteError("c", new Set())).toBeNull();
  });
});

describe("emailChangeTarget", () => {
  it("returns the target only when update-user sets an email", () => {
    expect(emailChangeTarget("/admin/update-user", { userId: "u", data: { email: "a@b.c" } })).toBe(
      "u",
    );
    expect(
      emailChangeTarget("/admin/update-user", { userId: "u", data: { name: "x" } }),
    ).toBeNull();
    expect(
      emailChangeTarget("/admin/set-role", { userId: "u", data: { email: "a@b.c" } }),
    ).toBeNull();
  });
});
