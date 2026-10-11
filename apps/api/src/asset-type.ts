import type { AssetMime } from "@necodoc/shared";

// Spec: docs/features/assets.md. The type comes from the bytes, never the name or the client.

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export function sniffAssetMime(bytes: Uint8Array): AssetMime | null {
  if (startsWith(bytes, [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, ascii("true"))) {
    return "font/ttf";
  }
  if (startsWith(bytes, ascii("OTTO"))) return "font/otf";
  if (startsWith(bytes, ascii("wOF2"))) return "font/woff2";
  return isSvg(bytes) ? "image/svg+xml" : null;
}

/** Text whose first element (after an optional XML declaration, doctype or comments) is <svg>. */
function isSvg(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  return /^\uFEFF?\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(
    text,
  );
}
