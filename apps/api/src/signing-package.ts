import { buffer } from "node:stream/consumers";
import {
  adobeSignAgreement,
  docusignEnvelope,
  dropboxSignRequest,
  type SigningOptions,
  type SigningPackage,
  signingOptionsSchema,
  type signingPackageQuerySchema,
  type V1SigningPackage,
} from "@necodoc/shared";
import type { z } from "zod";
import { db } from "./db";
import { mintLink } from "./download";
import { findFile, openFile } from "./files";

// Spec: docs/features/signing-packages.md. A generation's stored package as the API answers it:
// a signed PDF link plus the provider JSON asked for, built on read (ADR 0033).

const EMPTY: SigningPackage = { signers: [], boxes: [], pages: [], anchors: false, warnings: [] };

/** The GET query as options; unset ones take their defaults. */
export function signingQueryOptions(query: z.infer<typeof signingPackageQuerySchema>) {
  return signingOptionsSchema.parse({
    ...(query.formats ? { formats: [query.formats].flat().flatMap((f) => f.split(",")) } : {}),
    ...(query.embedPdf ? { embedPdf: query.embedPdf === "true" } : {}),
    ...(query.placement ? { placement: query.placement } : {}),
  });
}

/**
 * The package for a finished generation with a PDF. Generations without signers or sign boxes
 * answer an empty one, so callers needn't special-case them.
 */
export async function signingResponse(
  row: {
    id: string;
    filename: string;
    pageCount: number | null;
    fileId: string;
    signing: SigningPackage | null;
  },
  options: Pick<SigningOptions, "formats" | "embedPdf" | "placement">,
  userId: string,
): Promise<V1SigningPackage> {
  const pkg = row.signing ?? {
    ...EMPTY,
    warnings: ["This document has no signers or sign boxes"],
  };
  const link = await mintLink({
    fileId: row.fileId,
    generationId: row.id,
    userId,
    expiresInSeconds: 3600,
  });
  const wants = new Set(options.formats);
  let base64: string | undefined;
  if (wants.has("docusign") && options.embedPdf) {
    const stored = await findFile(db, row.fileId);
    if (stored) base64 = (await buffer(await openFile(db, stored))).toString("base64");
  }
  return {
    generationId: row.id,
    filename: row.filename,
    pageCount: row.pageCount ?? pkg.pages.length,
    pdfUrl: link.url,
    pdfPath: `/api/v1/generations/${row.id}/pdf`,
    ...pkg,
    formats: {
      ...(wants.has("docusign")
        ? {
            docusign: docusignEnvelope(
              pkg,
              { name: row.filename, ...(base64 ? { base64 } : {}) },
              options.placement,
            ),
          }
        : {}),
      ...(wants.has("dropbox_sign") ? { dropbox_sign: dropboxSignRequest(pkg) } : {}),
      ...(wants.has("adobe_sign") ? { adobe_sign: adobeSignAgreement(pkg) } : {}),
    },
  };
}
