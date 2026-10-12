import { PDFDocument } from "@cantoo/pdf-lib";
import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));
vi.mock("./generate", () => ({ renderPreview: vi.fn() }));
vi.mock("./log", () => ({ log: { warn: vi.fn() } }));

const { pageOneImage, thumbnailSource } = await import("./thumbnail");

describe("pageOneImage", () => {
  it("renders only page 1, 360px across, as WebP", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([300, 300]);
    const image = await pageOneImage(await doc.save());
    const decoded = await loadImage(Buffer.from(image));
    expect(String.fromCharCode(...image.subarray(8, 12))).toBe("WEBP");
    expect([decoded.width, decoded.height]).toEqual([360, 466]);
  });
});

describe("thumbnailSource", () => {
  it("follows the latest version, or the draft's last save before one", () => {
    const saved = new Date("2026-10-01T00:00:00Z");
    expect(thumbnailSource("abc", saved)).toBe("v-abc");
    expect(thumbnailSource(null, saved)).toBe(`d-${saved.getTime()}`);
  });
});
