import { describe, expect, it } from "vitest";
import { outputOverridesSchema } from "./output";

describe("outputOverridesSchema", () => {
  it("keeps only the options given, so the rest stay the template's", () => {
    expect(outputOverridesSchema.parse({ lang: "fr" })).toEqual({ lang: "fr" });
    expect(outputOverridesSchema.parse({ certify: false })).toEqual({ certify: false });
    expect(outputOverridesSchema.parse({ pdfa: null })).toEqual({ pdfa: null });
  });
});
