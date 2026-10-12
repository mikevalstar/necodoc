import { blockingTemplates, type ThemeSettings, usageCount } from "@necodoc/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));

const { groupAssetUsage, groupThemeUsage } = await import("./usage");

const logo = "11111111-1111-4111-8111-111111111111";
const font = "22222222-2222-4222-8222-222222222222";
const live = { id: "a0000000-0000-4000-8000-000000000001", name: "Letter", archivedAt: null };
const old = {
  id: "a0000000-0000-4000-8000-000000000002",
  name: "Archived",
  archivedAt: new Date(),
};

describe("groupAssetUsage", () => {
  const usages = groupAssetUsage({
    templates: [
      { ...live, ids: [] },
      { ...old, ids: [logo] },
    ],
    versions: [
      { templateId: live.id, version: 3, ids: [logo, font] },
      { templateId: live.id, version: 2, ids: [logo] },
      { templateId: old.id, version: 1, ids: [logo] },
    ],
    themes: [{ id: "t", name: "House", ids: [font] }],
    snippets: [{ id: "s", name: "Letterhead", ids: [logo] }],
  });

  it("lists templates by name with the draft and published versions that reference the asset", () => {
    expect(usages.get(logo)?.templates).toEqual([
      { id: old.id, name: "Archived", archived: true, draft: true, versions: [1] },
      { id: live.id, name: "Letter", archived: false, draft: false, versions: [3, 2] },
    ]);
    expect(usages.get(logo)?.snippets).toEqual([{ id: "s", name: "Letterhead" }]);
  });

  it("counts every user, and blocks deletion only for live templates with published versions", () => {
    const logoUsage = usages.get(logo);
    const fontUsage = usages.get(font);
    if (!logoUsage || !fontUsage) throw new Error("missing usage");
    expect(usageCount(logoUsage)).toBe(3);
    expect(blockingTemplates(logoUsage).map((t) => t.name)).toEqual(["Letter"]);
    expect(fontUsage.themes).toEqual([{ id: "t", name: "House" }]);
  });

  it("drafts alone don't block", () => {
    const draftOnly = groupAssetUsage({
      templates: [{ ...live, ids: [logo] }],
      versions: [],
      themes: [],
      snippets: [],
    }).get(logo);
    if (!draftOnly) throw new Error("missing usage");
    expect(blockingTemplates(draftOnly)).toEqual([]);
  });

  it("leaves unused assets out", () => {
    expect(usages.has("33333333-3333-4333-8333-333333333333")).toBe(false);
  });
});

describe("groupThemeUsage", () => {
  const settingsNow: ThemeSettings = {
    font: { assetId: font },
    fontSize: 10,
    lineHeight: 1.4,
    textColor: "#111111",
    accentColor: "#123456",
    linkColor: "#123456",
    headingFont: { assetId: font },
    headingColor: "#111111",
    h1Size: 20,
    h2Size: 16,
    h3Size: 13,
    tableBorderColor: "#cccccc",
    tableHeaderBackground: "#eeeeee",
    tableCellPadding: 2,
  };
  const settingsThen: ThemeSettings = { ...settingsNow, accentColor: "#000000" };

  it("marks versions on an older copy, and drafts using the theme", () => {
    const usages = groupThemeUsage({
      themes: [{ id: "t", settings: settingsNow, css: "" }],
      templates: [
        { ...live, themeId: "t" },
        { ...old, themeId: null },
      ],
      versions: [
        // Key order doesn't matter: copies compare by content.
        {
          templateId: live.id,
          version: 2,
          themeId: "t",
          theme: { css: "", settings: settingsNow },
        },
        {
          templateId: live.id,
          version: 1,
          themeId: "t",
          theme: { settings: settingsThen, css: "" },
        },
        {
          templateId: old.id,
          version: 1,
          themeId: "t",
          theme: { settings: settingsNow, css: "x" },
        },
        { templateId: old.id, version: 2, themeId: null, theme: null },
      ],
    });
    expect(usages.get("t")?.templates).toEqual([
      {
        id: old.id,
        name: "Archived",
        archived: true,
        draft: false,
        versions: [{ version: 1, current: false }],
      },
      {
        id: live.id,
        name: "Letter",
        archived: false,
        draft: true,
        versions: [
          { version: 2, current: true },
          { version: 1, current: false },
        ],
      },
    ]);
  });
});
