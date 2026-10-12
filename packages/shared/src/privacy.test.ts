import { describe, expect, it } from "vitest";
import type { FieldSection } from "./fields";
import { erasureRequestSchema, isSensitiveField, MASKED, maskData, scrubValues } from "./privacy";

const sections: FieldSection[] = [
  {
    title: "Client",
    fields: [
      { type: "text", key: "client_name", label: "Name", required: false },
      { type: "text", key: "client_sin", label: "SIN", required: false },
      { type: "email", key: "email", label: "Email", required: false, sensitive: true },
      { type: "signature", key: "signed", label: "Signature", required: false },
      { type: "text", key: "tax_id", label: "Tax id", required: false, sensitive: false },
      {
        type: "group",
        key: "dependents",
        label: "Dependents",
        required: false,
        fields: [
          { type: "text", key: "name", label: "Name", required: false },
          { type: "date", key: "date_of_birth", label: "Born", required: false },
        ],
      },
    ],
  },
];

describe("isSensitiveField", () => {
  it("follows an explicit flag, else signatures and id-like keys", () => {
    expect(isSensitiveField({ key: "client_name", type: "text" })).toBe(false);
    expect(isSensitiveField({ key: "client_sin", type: "text" })).toBe(true);
    expect(isSensitiveField({ key: "ssn", type: "text" })).toBe(true);
    expect(isSensitiveField({ key: "since", type: "date" })).toBe(false);
    expect(isSensitiveField({ key: "sig", type: "signature" })).toBe(true);
    expect(isSensitiveField({ key: "sig", type: "signature", sensitive: false })).toBe(false);
    expect(isSensitiveField({ key: "note", type: "text", sensitive: true })).toBe(true);
  });
});

describe("maskData", () => {
  it("masks sensitive fields, group children included, and keeps the rest", () => {
    expect(
      maskData(
        {
          client_name: "Ada",
          client_sin: "123-456-789",
          email: "ada@example.com",
          signed: "data:image/png;base64,AAAA",
          tax_id: "T-1",
          dependents: [{ name: "Bob", date_of_birth: "2010-01-01" }],
          extra_passport_number: "X1",
        },
        sections,
      ),
    ).toEqual({
      client_name: "Ada",
      client_sin: MASKED,
      email: MASKED,
      signed: MASKED,
      tax_id: "T-1",
      dependents: [{ name: "Bob", date_of_birth: MASKED }],
      extra_passport_number: MASKED,
    });
  });

  it("decides by key alone without fields, at any depth", () => {
    expect(maskData({ name: "Ada", person: { ssn: "1", items: [{ iban: "DE" }] } }, null)).toEqual({
      name: "Ada",
      person: { ssn: MASKED, items: [{ iban: MASKED }] },
    });
  });
});

describe("scrubValues", () => {
  it("replaces every value of the data, longest first, and leaves short ones", () => {
    const data = { name: "Ada Lovelace", first: "Ada", n: 12345, flag: "ok" };
    expect(scrubValues("Can't render Ada Lovelace (12345): ok", data)).toBe(
      `Can't render ${MASKED} (${MASKED}): ok`,
    );
  });
});

describe("erasureRequestSchema", () => {
  it("needs at least one pick", () => {
    expect(erasureRequestSchema.safeParse({ q: "ada@example.com" }).success).toBe(false);
    expect(
      erasureRequestSchema.safeParse({
        q: "ada@example.com",
        submissionIds: ["00000000-0000-4000-8000-000000000000"],
      }).success,
    ).toBe(true);
  });
});
