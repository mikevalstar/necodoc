import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { file, generation } from "./db/schema";
import { fileBytes } from "./files";
import { storage } from "./storage";
import { objectKey } from "./storage/config";

// ADR 0023: `pnpm --filter @necodoc/api storage:migrate` (or `node dist/storage-migrate.mjs`)
// moves generation outputs still in Postgres to the configured driver. Each file is copied, read
// back and checked against its SHA-256, then its row switches to the driver and its bytea is
// cleared in one update. Resumable: a rerun picks up whatever is still in Postgres. Assets and
// uploaded PDFs stay where they are (ADR 0014).

const PAGE = 500;

const sha256 = async (chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) => {
  const hash = createHash("sha256");
  for await (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
};

async function move({
  id,
  mimeType,
  sha256: expected,
}: {
  id: string;
  mimeType: string;
  sha256: string;
}) {
  const stored = await fileBytes(db, id);
  if (!stored) return "gone";
  if ((await sha256([stored.bytes])) !== expected) {
    throw new Error("the bytes in Postgres don't match the recorded SHA-256; left in place");
  }
  const key = objectKey(id, storage.prefix);
  await storage.put(key, Readable.from([stored.bytes]), mimeType);
  const readBack: AsyncIterable<Uint8Array> = await storage.get(key);
  if ((await sha256(readBack)) !== expected) {
    await storage.delete([key]);
    throw new Error("the stored copy doesn't match the SHA-256; removed it and left the original");
  }
  const [switched] = await db
    .update(file)
    .set({ storage: storage.name, key, bytes: null })
    .where(and(eq(file.id, id), eq(file.storage, "db")))
    .returning({ id: file.id });
  // Deleted, or moved by a concurrent run, while we copied.
  if (!switched) {
    await storage.delete([key]);
    return "gone";
  }
  return "moved";
}

console.log(
  `storage:migrate: generation outputs in Postgres → ${storage.name} (${storage.target})`,
);
await storage.check();

const outputs = db
  .select({ id: generation.outputFileId })
  .from(generation)
  .where(isNotNull(generation.outputFileId));
const counts = { moved: 0, gone: 0, failed: 0 };
let cursor = "00000000-0000-0000-0000-000000000000";
for (;;) {
  const page = await db
    .select({ id: file.id, mimeType: file.mimeType, sha256: file.sha256 })
    .from(file)
    .where(and(eq(file.storage, "db"), gt(file.id, cursor), inArray(file.id, outputs)))
    .orderBy(asc(file.id))
    .limit(PAGE);
  if (!page.length) break;
  for (const row of page) {
    cursor = row.id;
    try {
      counts[await move(row)]++;
    } catch (error) {
      counts.failed++;
      console.error(`  ${row.id}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`  ${counts.moved} moved, ${counts.failed} failed so far`);
}

console.log(
  `storage:migrate: done. ${counts.moved} moved, ${counts.gone} deleted meanwhile, ${counts.failed} failed.`,
);
if (counts.moved) {
  console.log("Postgres reuses the freed space; `VACUUM FULL file` returns it to the disk.");
}
await db.$client.end();
process.exit(counts.failed ? 1 : 0);
