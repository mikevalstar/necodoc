import { describe, expect, it } from "vitest";
import { htmlDocument } from "./document";

describe("htmlDocument", () => {
  it("sets lang, and dir for right-to-left languages (ADR 0040)", () => {
    expect(htmlDocument({ body: "", css: [] })).toContain('<html lang="en" dir="ltr">');
    expect(htmlDocument({ body: "", css: [], lang: "ar-EG" })).toContain(
      '<html lang="ar-EG" dir="rtl">',
    );
  });

  it("falls back to bundled Arabic and Hebrew faces after the default font", () => {
    const html = htmlDocument({ body: "", css: [] });
    expect(html).toContain('font-family: "Noto Sans", "Noto Sans Arabic", "Noto Sans Hebrew"');
    expect(html).toMatch(/fonts\/noto-sans-arabic\/[\w.-]+\.woff2/);
  });
});
