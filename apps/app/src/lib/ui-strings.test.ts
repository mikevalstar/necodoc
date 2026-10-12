import { fieldErrors, fieldSectionsSchema, templateDataSchema } from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { formatDay, issueMessage, uiStrings } from "./ui-strings";

const sections = fieldSectionsSchema.parse([
  {
    title: "About",
    fields: [
      { key: "name", type: "text", label: "Name", required: true },
      { key: "code", type: "text", label: "Code", minLength: 3, pattern: "[A-Z]+" },
      { key: "qty", type: "number", label: "Qty", max: 1000, decimals: 0 },
      { key: "price", type: "number", label: "Price", decimals: 2 },
      { key: "start", type: "date", label: "Start", min: "2026-01-15" },
      { key: "email", type: "email", label: "Email" },
    ],
  },
]);

const errors = (data: Record<string, unknown>, lang: string) => {
  const parsed = templateDataSchema(sections).safeParse(data);
  if (parsed.success) throw new Error("expected errors");
  return fieldErrors(parsed.error, (issue) => issueMessage(issue, lang));
};

describe("uiStrings", () => {
  it("picks the exact tag, then the language, then English", () => {
    expect(uiStrings("fr-CA").next).toBe("Suivant");
    expect(uiStrings("FR").step(2, 5)).toBe("Étape 2 sur 5");
    expect(uiStrings("de").next).toBe("Next");
    expect(uiStrings("en-US").back).toBe("Back");
  });
});

describe("issueMessage", () => {
  const bad = { code: "ab", qty: 1500.5, price: 1.234, start: "2026-01-01", email: "nope" };

  it("translates validation messages by code and params", () => {
    expect(errors(bad, "fr-CA")).toEqual({
      name: ["Obligatoire"],
      code: ["Entrez au moins 3 caractères", "Le format attendu n'est pas respecté"],
      qty: [
        `Doit être d'au plus ${new Intl.NumberFormat("fr-CA").format(1000)}`,
        "Entrez un nombre entier",
      ],
      price: ["Utilisez au plus 2 décimales"],
      start: [`Doit être le ${formatDay("2026-01-15", "fr-CA")} ou après`],
      email: ["Entrez une adresse courriel valide"],
    });
  });

  it("reads plainly in English", () => {
    expect(errors(bad, "en")).toMatchObject({
      name: ["Required"],
      code: ["Enter at least 3 characters", "Doesn't match the expected format"],
      qty: ["Must be at most 1,000", "Enter a whole number"],
      start: ["Must be on or after Jan 15, 2026"],
      email: ["Enter a valid email address"],
    });
  });
});

describe("formatDay", () => {
  it("formats field dates for the language, whatever the time zone", () => {
    expect(formatDay("2026-01-15", "en")).toBe("Jan 15, 2026");
    expect(formatDay("2026-01-15", "fr-CA")).toMatch(/^15 janv\. 2026$/);
    expect(formatDay("not a date", "en")).toBe("not a date");
  });
});
