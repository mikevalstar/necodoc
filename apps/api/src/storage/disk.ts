import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { DriverConfig, StorageDriver } from "./index";

// ADR 0023: a directory, local or a shared mount (NFS, EFS, Azure Files) when several hosts run.

export function diskDriver({ dir }: DriverConfig<"disk">): StorageDriver {
  const root = resolve(dir);
  const pathOf = (key: string) => {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`Key escapes the storage directory: ${key}`);
    return path;
  };

  return {
    name: "disk",
    target: root,
    prefix: "",
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Same directory, so the rename is atomic; `flush` fsyncs before close.
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await pipeline(body, createWriteStream(temp, { flags: "wx", flush: true }));
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async get(key, range) {
      // Opening first makes a missing file reject here rather than error the stream later.
      const handle = await open(pathOf(key), "r");
      return handle.createReadStream(range ?? {});
    },
    async delete(keys) {
      await Promise.all(keys.map((key) => rm(pathOf(key), { force: true })));
    },
    async check() {
      // A real round trip: catches a missing or read-only mount, not just a missing directory.
      const path = pathOf(`.probe/${hostname()}-${process.pid}-${randomUUID()}`);
      const content = randomUUID();
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, content);
        if ((await readFile(path, "utf8")) !== content) {
          throw new Error("The probe file read back different content");
        }
      } finally {
        await rm(path, { force: true });
      }
    },
  };
}
