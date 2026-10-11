/** Headers for serving a stored PDF inline, with a filename for "save as". */
export const pdfHeaders = (filename: string) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
});

/**
 * Headers for serving user-uploaded bytes. The sandbox CSP stops an uploaded SVG from running
 * script if someone opens it directly.
 */
export const fileHeaders = (mimeType: string) => ({
  "Content-Type": mimeType,
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=31536000, immutable",
});
