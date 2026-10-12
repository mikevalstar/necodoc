import { describe, expect, it } from "vitest";
import { dayjs } from "@/lib/date";
import {
  generationFiltersSearchSchema,
  noFilters,
  parseFilters,
  serializeFilters,
  sinceInstant,
  suggest,
  type TokenLookups,
  tokenize,
} from "./-filter-tokens";

const templateId = "11111111-1111-4111-8111-111111111111";
const batchId = "3f2a9c00-2222-4222-8222-222222222222";
const lookups: TokenLookups = {
  templates: [
    { id: templateId, name: "Notary Public Bond" },
    { id: "33333333-3333-4333-8333-333333333333", name: "Quote" },
  ],
  users: [{ id: "u1", name: "Alice Admin", email: "alice@example.com" }],
  keys: [{ id: "k1", name: "prod-portal" }],
  batches: [{ id: batchId, label: "Quote · 2026-10-01 10:00" }],
  isAdmin: true,
};

describe("parseFilters", () => {
  it("maps every token kind to URL filters", () => {
    const { filters, errors } = parseFilters(
      'status:failed,cancelled source:api,batch render:>0.5s since:7d until:2026-10-12 template:"notary public bond" user:alice@example.com key:prod batch:3f2a invoice',
      lookups,
    );
    expect(errors).toEqual([]);
    expect(filters).toEqual({
      ...noFilters,
      status: ["error", "cancelled"],
      source: ["api", "batch"],
      slowerThan: 0.5,
      since: "7d",
      to: "2026-10-12",
      templateId,
      userId: "u1",
      apiKeyId: "k1",
      batchId,
      q: "invoice",
    });
  });

  it("reads ranges, upper bounds and milliseconds", () => {
    expect(parseFilters("render:0.5s..2s", lookups).filters).toMatchObject({
      slowerThan: 0.5,
      fasterThan: 2,
    });
    expect(parseFilters("render:<500ms", lookups).filters).toMatchObject({
      slowerThan: undefined,
      fasterThan: 0.5,
    });
  });

  it("reports what it can't read instead of dropping it", () => {
    const { errors } = parseFilters(
      "status:nope colour:red render:2s..1s since:soon template:missing",
      lookups,
    );
    expect(errors).toHaveLength(5);
  });

  it("refuses a user filter for non-admins", () => {
    expect(parseFilters("user:alice", { ...lookups, isAdmin: false }).errors).toEqual([
      "Only admins can filter by user.",
    ]);
  });

  it("keeps free text with colons in it when quoted, and times as text", () => {
    expect(parseFilters('"req:abc" 10:42', lookups).filters.q).toBe("req:abc 10:42");
  });
});

describe("serializeFilters", () => {
  it("round-trips through parseFilters", () => {
    const filters = {
      ...noFilters,
      status: ["error" as const],
      source: ["api" as const, "share_link" as const],
      slowerThan: 0.5,
      fasterThan: 2,
      from: "2026-10-01",
      templateId,
      apiKeyId: "k1",
      batchId,
      q: "a:b",
    };
    const text = serializeFilters(filters, lookups);
    expect(text).toBe(
      'status:error source:api,share_link render:0.5s..2s since:2026-10-01 template:"Notary Public Bond" key:prod-portal batch:3f2a9c00 "a:b"',
    );
    expect(parseFilters(text, lookups)).toEqual({ filters, errors: [] });
  });

  it("shows ids it can't name", () => {
    expect(serializeFilters({ ...noFilters, userId: "gone" }, lookups)).toBe("user:gone");
  });
});

describe("tokenize", () => {
  it("keeps quoted values whole", () => {
    expect(tokenize('template:"A B" "free text" x')).toEqual([
      'template:"A B"',
      '"free text"',
      "x",
    ]);
  });
});

describe("suggest", () => {
  it("offers keys, then values for the key under the caret", () => {
    expect(suggest("st", 2, lookups).items.map((s) => s.insert)).toEqual(["status:"]);
    const values = suggest("status:error,c", 14, lookups);
    expect(values.items.map((s) => s.insert)).toEqual(["status:error,cancelled"]);
    expect(values).toMatchObject({ start: 0, end: 14 });
  });

  it("quotes names with spaces and hides user for non-admins", () => {
    expect(suggest("template:nota", 13, lookups).items[0]?.insert).toBe(
      'template:"Notary Public Bond"',
    );
    const keys = suggest("", 0, { ...lookups, isAdmin: false }).items.map((s) => s.label);
    expect(keys).not.toContain("user:");
  });
});

describe("search schema", () => {
  it("accepts one status from old links as a list", () => {
    expect(generationFiltersSearchSchema.parse({ status: "error" }).status).toEqual(["error"]);
  });

  it("turns a relative since into an instant", () => {
    const now = dayjs("2026-10-12T10:30:45Z");
    expect(sinceInstant("24h", now)).toBe("2026-10-11T10:30:00.000Z");
    expect(sinceInstant("7d", now)).toBe("2026-10-05T10:30:00.000Z");
  });
});
