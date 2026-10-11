import { describe, expect, it } from "vitest";
import { analyticsBucket, analyticsRangeSchema } from "./analytics";

const at = (iso: string) => new Date(iso);

describe("analyticsBucket", () => {
  it("uses hours up to 2 days, days up to 90, weeks beyond", () => {
    expect(analyticsBucket(at("2026-10-01T00:00:00Z"), at("2026-10-03T00:00:00Z"))).toBe("hour");
    expect(analyticsBucket(at("2026-10-01T00:00:00Z"), at("2026-10-04T00:00:00Z"))).toBe("day");
    expect(analyticsBucket(at("2026-07-01T00:00:00Z"), at("2026-09-29T00:00:00Z"))).toBe("day");
    expect(analyticsBucket(at("2026-01-01T00:00:00Z"), at("2026-10-01T00:00:00Z"))).toBe("week");
  });
});

describe("analyticsRangeSchema", () => {
  const range = { from: "2026-10-01T00:00:00Z", to: "2026-10-08T00:00:00Z" };

  it("defaults the zone to UTC", () => {
    expect(analyticsRangeSchema.parse(range).tz).toBe("UTC");
  });

  it("rejects unknown zones, reversed ranges and ranges over 400 days", () => {
    expect(analyticsRangeSchema.safeParse({ ...range, tz: "Mars/Olympus" }).success).toBe(false);
    expect(analyticsRangeSchema.safeParse({ from: range.to, to: range.from }).success).toBe(false);
    expect(
      analyticsRangeSchema.safeParse({ from: "2025-01-01T00:00:00Z", to: "2026-10-01T00:00:00Z" })
        .success,
    ).toBe(false);
  });
});
