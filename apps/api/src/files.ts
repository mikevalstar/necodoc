import { createHash, randomUUID } from "node:crypto";
import { pipeline, Readable, Transform } from "node:stream";
import { MAX_FILE_BYTES } from "@necodoc/shared";
import { eq, type SQL } from "drizzle-orm";
import type { db } from "./db";
import { type FileStorage, file } from "./db/schema";
import { log } from "./log";
import { type ByteRange, type PresignOptions, storage } from "./storage";
import { objectKey, type StorageDriverName } from "./storage/config";

// The one module that touches file bytes. Base data (assets, uploaded PDFs) keeps them in the row
// (ADR 0014); generated outputs go to the storage driver (ADR 0023). Rows hold the metadata either way.

type Executor = Pick<typeof db, "insert" | "select" | "delete">;

export class FileTooLargeError extends Error {
  constructor() {
    super(`Files are limited to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
}

/** The storage driver failed; worth a retry, unlike a template error. */
export class StorageError extends Error {
  constructor(action: string, cause: unknown) {
    super(
      `Couldn't ${action} (${storage.name}): ${cause instanceof Error ? cause.message : cause}`,
      {
        cause,
      },
    );
  }
}

/** Stores base data in Postgres. */
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

/** Bytes of a file kept in Postgres (base data). Null if it's missing or lives in the driver. */
export async function fileBytes(tx: Executor, id: string) {
  const [row] = await tx
    .select({ bytes: file.bytes, mimeType: file.mimeType })
    .from(file)
    .where(eq(file.id, id));
  return row?.bytes ? { bytes: row.bytes, mimeType: row.mimeType } : null;
}

/** Hashes and counts what passes through, failing past the size limit. */
function measure() {
  const hash = createHash("sha256");
  let size = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > MAX_FILE_BYTES) return callback(new FileTooLargeError());
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ size, sha256: hash.digest("hex") }) };
}

/** A file row ready to insert, for an object `writeOutput` has stored. */
export type WrittenOutput = typeof file.$inferInsert & {
  id: string;
  key: string;
  storage: StorageDriverName;
};

/**
 * Streams a generated output into the driver and returns its row, for the caller to insert in
 * its own transaction. If that transaction doesn't commit, `deleteObjects([output])`.
 */
export async function writeOutput({
  body,
  mimeType,
  ownerId,
}: {
  body: Readable;
  mimeType: string;
  ownerId: string | null;
}): Promise<WrittenOutput> {
  const id = randomUUID();
  const key = objectKey(id, storage.prefix);
  const measured = measure();
  try {
    // pipeline() carries a source error through to the driver, which then fails the write.
    await storage.put(
      key,
      pipeline(body, measured.stream, () => {}),
      mimeType,
    );
  } catch (error) {
    if (error instanceof FileTooLargeError) throw error;
    throw new StorageError("store the output", error);
  }
  return { id, key, storage: storage.name, mimeType, ownerId, ...measured.result() };
}

/** A file as downloads see it: metadata and where its bytes are. */
export type StoredFile = { id: string; mimeType: string; size: number; sha256: string } & (
  | { storage: "db" }
  | { storage: StorageDriverName; key: string }
);

export async function findFile(tx: Executor, id: string): Promise<StoredFile | null> {
  const [row] = await tx
    .select({
      id: file.id,
      mimeType: file.mimeType,
      size: file.size,
      sha256: file.sha256,
      storage: file.storage,
      key: file.key,
    })
    .from(file)
    .where(eq(file.id, id));
  if (!row) return null;
  const { storage: location, key, ...meta } = row;
  // The file_location check guarantees a key outside the db.
  return location === "db" || !key
    ? { ...meta, storage: "db" }
    : { ...meta, storage: location, key };
}

/** This node reads and deletes objects only through the driver it's configured for. */
function activeKey(stored: { storage: FileStorage; key: string | null }) {
  if (stored.storage !== storage.name || !stored.key) {
    throw new StorageError(
      "read the file",
      `it's stored in ${stored.storage}, but STORAGE_DRIVER is ${storage.name}`,
    );
  }
  return stored.key;
}

/** Streams a file's bytes, or an inclusive range of them, from wherever they are. */
export async function openFile(tx: Executor, stored: StoredFile, range?: ByteRange) {
  if (stored.storage === "db") {
    const row = await fileBytes(tx, stored.id);
    if (!row) throw new Error(`File ${stored.id} has no bytes`);
    return Readable.from([range ? row.bytes.subarray(range.start, range.end + 1) : row.bytes]);
  }
  const key = activeKey(stored);
  try {
    return await storage.get(key, range);
  } catch (error) {
    throw new StorageError("read the file", error);
  }
}

/** ADR 0023: a short-lived URL to the object itself, or null if the file or driver can't have one. */
export async function presignFile(stored: StoredFile, options: PresignOptions) {
  if (stored.storage === "db" || stored.storage !== storage.name || !storage.presign) return null;
  return storage.presign(stored.key, options);
}

type ObjectRef = { storage: FileStorage; key: string | null };

/**
 * Deletes file rows and returns the objects that held their bytes. Call `deleteObjects` with
 * them once the transaction has committed, so a rollback never loses bytes.
 */
export async function deleteFiles(tx: Executor, where: SQL): Promise<ObjectRef[]> {
  return tx.delete(file).where(where).returning({ storage: file.storage, key: file.key });
}

/**
 * Deletes driver objects. Best effort: the rows are already gone, so a failure is logged (an
 * orphaned object, ADR 0023) rather than thrown. Returns how many were left behind.
 */
export async function deleteObjects(objects: ObjectRef[]) {
  const stored = objects.filter((object) => object.storage !== "db");
  if (!stored.length) return 0;
  try {
    await storage.delete(stored.map(activeKey));
    return 0;
  } catch (error) {
    log.error({ err: error, objects: stored.length }, "storage: objects left behind");
    return stored.length;
  }
}
