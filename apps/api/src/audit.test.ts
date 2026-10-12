import { MASKED } from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { changedFields, maskValues, sectionsOf } from "./audit-diff";

describe("changedFields", () => {
  it("keeps only changed fields, each whole", () => {
    const content = { blocks: [{ text: "a" }] };
    expect(
      changedFields(
        { name: "A", css: "", content, updatedAt: new Date(1) },
        { name: "B", css: "", content: { blocks: [{ text: "b" }] }, updatedAt: new Date(2) },
      ),
    ).toEqual({
      before: { name: "A", content },
      after: { name: "B", content: { blocks: [{ text: "b" }] } },
    });
  });

  it("ignores key order inside JSON values", () => {
    expect(changedFields({ s: { a: 1, b: 2 } }, { s: { b: 2, a: 1 } })).toEqual({
      before: null,
      after: null,
    });
  });

  it("keeps everything on create and delete, never secrets", () => {
    expect(changedFields(null, { url: "https://x", secret: "s", token: "t" })).toEqual({
      before: null,
      after: { url: "https://x" },
    });
    expect(changedFields({ at: new Date(0) }, null)).toEqual({
      before: { at: "1970-01-01T00:00:00.000Z" },
      after: null,
    });
  });

  it("records nothing when only a secret changed", () => {
    expect(changedFields({ secret: "a" }, { secret: "b" })).toEqual({ before: null, after: null });
  });
});

describe("maskValues", () => {
  const sections = [
    {
      title: "S",
      fields: [
        { type: "text" as const, key: "name", label: "Name", required: false },
        {
          type: "text" as const,
          key: "secret_code",
          label: "Code",
          required: false,
          sensitive: true,
        },
      ],
    },
  ];

  it("masks sensitive values in sample data, prefills and test data, nothing else", () => {
    expect(
      maskValues(
        {
          sampleData: { name: "Ada", secret_code: "42" },
          prefill: { secret_code: "7" },
          data: { name: "Bob", sin: "1" },
          label: "secret_code",
        },
        sections,
      ),
    ).toEqual({
      sampleData: { name: "Ada", secret_code: MASKED },
      prefill: { secret_code: MASKED },
      data: { name: "Bob", sin: MASKED },
      label: "secret_code",
    });
  });

  it("uses a template row's own sections", () => {
    expect(sectionsOf({ sections })).toBe(sections);
    expect(sectionsOf({ sections: "no" })).toBeNull();
  });
});
