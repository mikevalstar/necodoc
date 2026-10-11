import { describe, expect, it } from "vitest";
import { sniffAssetMime } from "./asset-type";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part)] : part)),
  );

describe("sniffAssetMime", () => {
  it("detects allowed types from their bytes", () => {
    expect(sniffAssetMime(bytes([0x89], "PNG\r\n", [0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffAssetMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffAssetMime(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffAssetMime(bytes([0, 1, 0, 0, 0, 0x10]))).toBe("font/ttf");
    expect(sniffAssetMime(bytes("OTTO", [0, 0]))).toBe("font/otf");
    expect(sniffAssetMime(bytes("wOF2", [0, 1]))).toBe("font/woff2");
    expect(sniffAssetMime(bytes('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="x"/>'))).toBe(
      "image/svg+xml",
    );
  });

  it("rejects anything else, whatever it claims to be", () => {
    expect(sniffAssetMime(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffAssetMime(bytes("<html><svg></svg></html>"))).toBeNull();
    expect(sniffAssetMime(bytes("GIF89a"))).toBeNull();
    expect(sniffAssetMime(new Uint8Array())).toBeNull();
  });
});
