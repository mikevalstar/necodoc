import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { visualDiff } from "./visual-diff";

async function pdf(...lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of lines) {
    doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 18, font });
  }
  return doc.save();
}

describe("visualDiff", () => {
  it("finds no change between identical renders", async () => {
    const { pages } = await visualDiff(await pdf("Same"), await pdf("Same"));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.changedPixels).toBe(0);
    expect(pages[0]?.afterText).toBe("Same");
  });

  it("marks the changed page, and a page only one side has", async () => {
    const { pages } = await visualDiff(await pdf("One", "Two"), await pdf("One", "Too", "Three"));
    expect(pages.map((p) => p.changedPixels > 0)).toEqual([false, true, true]);
    expect(pages[2]?.before).toBeNull();
    expect(pages[2]?.changedPercent).toBe(100);
    expect(pages[1]?.diff).toMatch(/^data:image\/png;base64,/);
  });
});
