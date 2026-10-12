import { describe, expect, it } from "vitest";
import { fieldSectionsSchema } from "./fields";
import {
  contentTexts,
  liquidTranslatables,
  stringsFor,
  textDirection,
  translate,
  translatableStrings,
  translateSections,
} from "./locale";
import { designedContentSchema } from "./template";

describe("stringsFor", () => {
  const translations = {
    fr: { Invoice: "Facture", Total: "Total", Draft: "" },
    "fr-CA": { Invoice: "Facture (CA)" },
  };

  it("puts the exact tag over its language, case-insensitively", () => {
    expect(stringsFor(translations, "fr-ca")).toEqual({ Invoice: "Facture (CA)", Total: "Total" });
    expect(stringsFor(translations, "FR-BE")).toEqual({ Invoice: "Facture", Total: "Total" });
    expect(stringsFor(translations, "de")).toEqual({});
    expect(stringsFor(undefined, "fr")).toEqual({});
  });

  it("falls back to the source text", () => {
    const fr = stringsFor(translations, "fr");
    expect(translate(fr, "Invoice")).toBe("Facture");
    expect(translate(fr, "Draft")).toBe("Draft");
    expect(translate(fr, "constructor")).toBe("constructor");
  });
});

describe("textDirection", () => {
  it("is rtl for RTL languages and scripts", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("he-IL")).toBe("rtl");
    expect(textDirection("fa")).toBe("rtl");
    expect(textDirection("az-Arab")).toBe("rtl");
    expect(textDirection("ku-Latn")).toBe("ltr");
    expect(textDirection("en")).toBe("ltr");
    expect(textDirection("ja")).toBe("ltr");
  });
});

const sections = fieldSectionsSchema.parse([
  {
    title: "You",
    description: "About you",
    fields: [
      { type: "text", key: "name", label: "Name", help: "Full name" },
      {
        type: "choice",
        key: "plan",
        label: "Plan",
        options: [{ value: "a", label: "Basic" }],
      },
      {
        type: "group",
        key: "kids",
        label: "Children",
        fields: [{ type: "text", key: "kid", label: "Name" }],
      },
    ],
  },
]);

describe("translateSections", () => {
  it("translates titles, labels, help and choice labels, keeping keys and values", () => {
    const [section] = translateSections(sections, {
      You: "Vous",
      Name: "Nom",
      "Full name": "Nom complet",
      Basic: "De base",
    });
    expect(section?.title).toBe("Vous");
    expect(section?.description).toBe("About you");
    expect(section?.fields.map((f) => [f.key, f.label])).toEqual([
      ["name", "Nom"],
      ["plan", "Plan"],
      ["kids", "Children"],
    ]);
    const [name, plan, kids] = section?.fields ?? [];
    expect(name?.help).toBe("Nom complet");
    expect(plan?.type === "choice" && plan.options).toEqual([{ value: "a", label: "De base" }]);
    expect(kids?.type === "group" && kids.fields[0]?.label).toBe("Nom");
  });
});

describe("translatable strings", () => {
  it("finds t literals in Liquid", () => {
    expect(liquidTranslatables(`{{ "Hi" | t }} {{ 'Bye' | t | upcase }} {{ "x" | truncate }}`)).toEqual(
      ["Hi", "Bye"],
    );
  });

  it("lists fields, then content text, without repeats or blanks", () => {
    const visual = designedContentSchema.parse({
      mode: "visual",
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: " Name " }] }],
      },
      footer: {
        height: 10,
        doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Page" }] }] },
      },
    });
    expect(translatableStrings(sections, contentTexts(visual))).toEqual([
      "You",
      "About you",
      "Name",
      "Full name",
      "Plan",
      "Basic",
      "Children",
      "Page",
    ]);
    const code = designedContentSchema.parse({ mode: "code", body: `<h1>{{ "Invoice" | t }}</h1>` });
    expect(contentTexts(code)).toEqual(["Invoice"]);
  });
});
