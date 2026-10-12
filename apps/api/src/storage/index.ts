import type { Readable } from "node:stream";
import { storageConfig } from "../env";
import type { StorageConfig, StorageDriverName } from "./config";

// ADR 0023: generated outputs live in one driver per deployment, picked by STORAGE_DRIVER.
// Only src/files.ts and the readiness check talk to it; SDKs load only for the driver in use.

/** Inclusive byte offsets, as in a Range header. */
export type ByteRange = { start: number; end: number };

export type PresignOptions = {
  expiresInSeconds: number;
  contentType: string;
  contentDisposition: string;
};

export type StorageDriver = {
  readonly name: StorageDriverName;
  /** Where objects go, for Admin > System. Never includes secrets. */
  readonly target: string;
  /** Prepended to new keys. */
  readonly prefix: string;
  /** Writes the whole stream; a reader sees the old object or the new one, never half. */
  put(key: string, body: Readable, contentType: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<Readable>;
  /** Missing keys are not an error. */
  delete(keys: string[]): Promise<void>;
  /** Throws unless the store is reachable (for disk: writable and readable). */
  check(): Promise<void>;
  /** A short-lived URL straight to the object, where the store has them. */
  presign?(key: string, options: PresignOptions): Promise<string>;
};

export type DriverConfig<Name extends StorageDriverName> = Extract<StorageConfig, { driver: Name }>;

async function createDriver(config: StorageConfig): Promise<StorageDriver> {
  switch (config.driver) {
    case "disk":
      return (await import("./disk")).diskDriver(config);
    case "s3":
      return (await import("./s3")).s3Driver(config);
    case "azure":
      return (await import("./azure")).azureDriver(config);
  }
}

export const storage = await createDriver(storageConfig);

/** Readiness and Admin › System: storage round-trips. A hung mount or endpoint fails, not hangs. */
export async function storageReachable() {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out after 5 s")), 5000);
  });
  try {
    await Promise.race([storage.check(), timeout]);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
