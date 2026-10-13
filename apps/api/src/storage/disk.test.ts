import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { objectKey } from "./config";
import { diskDriver } from "./disk";

describe("disk driver", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "necodoc-disk-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const key = objectKey("3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6b");
  const bytes = Buffer.from("%PDF-1.7 hello world");

  it("writes, reads whole and in ranges, and deletes", async () => {
    const driver = diskDriver({ driver: "disk", dir });
    await driver.put(
      key,
      Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
      "application/pdf",
    );
    expect(await buffer(await driver.get(key))).toEqual(bytes);
    expect((await buffer(await driver.get(key, { start: 9, end: 13 }))).toString()).toBe("hello");
    // Sharded, and no temp file left behind.
    expect(await readdir(join(dir, "3f", "2a"))).toEqual([key.split("/").at(-1)]);
    await driver.delete([key, objectKey("00000000-0000-4000-8000-000000000000")]);
    await expect(driver.get(key)).rejects.toThrow(/ENOENT/);
  });

  it("leaves no partial file when the source fails", async () => {
    const driver = diskDriver({ driver: "disk", dir });
    const failing = new Readable({
      read() {
        this.push(bytes);
        this.destroy(new Error("source broke"));
      },
    });
    await expect(driver.put(key, failing, "application/pdf")).rejects.toThrow("source broke");
    expect(await readdir(join(dir, "3f", "2a"))).toEqual([]);
  });

  it("keeps keys inside the directory", async () => {
    const driver = diskDriver({ driver: "disk", dir });
    await expect(driver.get("../outside")).rejects.toThrow(/escapes/);
  });

  it("passes the readiness probe on a writable directory and fails on a missing mount", async () => {
    await expect(diskDriver({ driver: "disk", dir }).check()).resolves.toBeUndefined();
    // Under a regular file, so it fails even as root (which can create /nonexistent-mount).
    const file = join(dir, "not-a-mount");
    await writeFile(file, "");
    await expect(
      diskDriver({ driver: "disk", dir: join(file, "necodoc") }).check(),
    ).rejects.toThrow();
  });
});
