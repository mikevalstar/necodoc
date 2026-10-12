import { describe, expect, it } from "vitest";
import { matches, parseRecent, pushRecent, RECENT_MAX, type Recent } from "./command-palette";

describe("matches", () => {
  it("needs every word, in any order, ignoring case", () => {
    expect(matches("Oregon contractor bond", "bond oregon")).toBe(true);
    expect(matches("Oregon contractor bond", "BOND")).toBe(true);
    expect(matches("Oregon contractor bond", "bond texas")).toBe(false);
  });
  it("matches everything for a blank query", () => {
    expect(matches("anything", "   ")).toBe(true);
  });
});

const page = (n: number): Recent => ({ href: `/p/${n}`, label: `P${n}`, kind: "Pages" });

describe("pushRecent", () => {
  it("puts the newest first and keeps one per href", () => {
    const list = pushRecent([page(1), page(2)], { ...page(2), label: "renamed" });
    expect(list.map((r) => r.label)).toEqual(["renamed", "P1"]);
  });
  it("caps the list", () => {
    let list: Recent[] = [];
    for (let n = 0; n < RECENT_MAX + 3; n++) list = pushRecent(list, page(n));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]?.href).toBe(`/p/${RECENT_MAX + 2}`);
  });
});

describe("parseRecent", () => {
  it("reads a stored list", () => {
    expect(parseRecent(JSON.stringify([page(1)]))).toEqual([page(1)]);
  });
  it("drops bad or foreign data", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent(JSON.stringify([{ href: "https://evil.example", label: "x" }]))).toEqual([]);
  });
});
