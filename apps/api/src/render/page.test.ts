import { pageOptionsSchema } from "@necodoc/shared";
import { describe, expect, it } from "vitest";
import { pageDimensions, pageLayout } from "./page";

describe("pageDimensions", () => {
  it("swaps width and height for landscape", () => {
    expect(pageDimensions({ size: "A4", orientation: "portrait" })).toEqual({
      width: 210,
      height: 297,
    });
    expect(pageDimensions({ size: "Legal", orientation: "landscape" })).toEqual({
      width: 355.6,
      height: 215.9,
    });
  });
});

describe("pageLayout", () => {
  const page = pageOptionsSchema.parse({
    size: "A4",
    margins: { top: 10, right: 15, bottom: 12, left: 15 },
  });

  it("reserves band heights in the body margins", () => {
    const layout = pageLayout(page, { html: "", height: 25 }, { html: "", height: 8 });
    expect(layout.bodyMargins).toEqual({ top: 35, right: 15, bottom: 20, left: 15 });
  });

  it("keeps the author's margins without bands", () => {
    expect(pageLayout(page).bodyMargins).toEqual(page.margins);
  });
});
