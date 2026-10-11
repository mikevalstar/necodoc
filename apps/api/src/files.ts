import { createHash } from "node:crypto";
import { MAX_FILE_BYTES } from "@necodoc/shared";
import { eq, inArray } from "drizzle-orm";
import type { db } from "./db";
import { file } from "./db/schema";

// The one module that touches file bytes (ADR 0014), so a later move to object storage stays small.

type Executor = Pick<typeof db, "insert" | "select" | "delete">;

export class FileTooLargeError extends Error {
  constructor() {
    super(`Files are limited to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
}

export async function storeFile(
  tx: Executor,
  {
    bytes,
    mimeType,
    ownerId,
  }: { bytes: Uint8Array<ArrayBuffer>; mimeType: string; ownerId: string | null },
) {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileTooLargeError();
  const [row] = await tx
    .insert(file)
    .values({
      bytes,
      mimeType,
      ownerId,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .returning({ id: file.id });
  if (!row) throw new Error("File insert returned no row");
  return row.id;
}

export async function fileBytes(tx: Executor, id: string) {
  const [row] = await tx
    .select({ bytes: file.bytes, mimeType: file.mimeType })
    .from(file)
    .where(eq(file.id, id));
  return row ?? null;
}

export async function deleteFiles(tx: Executor, ids: string[]) {
  if (ids.length) await tx.delete(file).where(inArray(file.id, ids));
}
