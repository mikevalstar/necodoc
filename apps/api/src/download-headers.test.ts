import { describe, expect, it } from "vitest";
import { contentDisposition, etagMatches, parseRange } from "./download-headers";

describe("parseRange", () => {
  it("reads closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("clamps to the file", () => {
    expect(parseRange("bytes=500-5000", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("flags ranges past the end", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("ignores what it doesn't serve", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("bytes=9-3", 1000)).toBeNull();
  });
});

describe("etagMatches", () => {
  const etag = '"abc"';
  it("matches exact, weak, listed and wildcard tags", () => {
    expect(etagMatches('"abc"', etag)).toBe(true);
    expect(etagMatches('W/"abc"', etag)).toBe(true);
    expect(etagMatches('"x", "abc"', etag)).toBe(true);
    expect(etagMatches("*", etag)).toBe(true);
  });
  it("misses others", () => {
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches('"abd"', etag)).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("keeps ASCII names and encodes the exact one", () => {
    expect(contentDisposition("inline", "Policy 12.pdf")).toBe(
      `inline; filename="Policy 12.pdf"; filename*=UTF-8''Policy%2012.pdf`,
    );
  });
  it("can't be broken out of with quotes or non-ASCII", () => {
    expect(contentDisposition("attachment", 'Ré"sumé\r\n.pdf')).toBe(
      `attachment; filename="R__sum___.pdf"; filename*=UTF-8''R%C3%A9%22sum%C3%A9%0D%0A.pdf`,
    );
  });
});
