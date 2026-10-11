import { describe, expect, it } from "vitest";
import { objectKey, storageEnvSchema } from "./config";

describe("storageEnvSchema", () => {
  it("defaults to disk under ./data/files", () => {
    expect(storageEnvSchema.parse({})).toEqual({ driver: "disk", dir: "./data/files" });
  });

  it("builds an S3 config, treating blank values as unset", () => {
    expect(
      storageEnvSchema.parse({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "out",
        S3_ENDPOINT: "",
        S3_FORCE_PATH_STYLE: "true",
        STORAGE_PREFIX: "/necodoc/outputs/",
        S3_SSE: "aws:kms",
        S3_KMS_KEY_ID: "key-1",
      }),
    ).toEqual({
      driver: "s3",
      bucket: "out",
      region: "us-east-1",
      endpoint: undefined,
      forcePathStyle: true,
      prefix: "necodoc/outputs/",
      credentials: undefined,
      encryption: { type: "aws:kms", kmsKeyId: "key-1" },
    });
  });

  it("refuses half a key pair and a KMS key without KMS", () => {
    const base = { STORAGE_DRIVER: "s3", S3_BUCKET: "out" };
    expect(storageEnvSchema.safeParse({ ...base, S3_ACCESS_KEY_ID: "a" }).success).toBe(false);
    expect(storageEnvSchema.safeParse({ ...base, S3_KMS_KEY_ID: "k" }).success).toBe(false);
  });

  it("picks the Azure credential from what is set", () => {
    const base = { STORAGE_DRIVER: "azure", AZURE_STORAGE_CONTAINER: "out" };
    const auth = (extra: Record<string, string>) => {
      const config = storageEnvSchema.parse({ ...base, ...extra });
      return config.driver === "azure" ? config.auth : null;
    };
    expect(auth({ AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true" })).toEqual({
      type: "connectionString",
      connectionString: "UseDevelopmentStorage=true",
    });
    expect(auth({ AZURE_STORAGE_ACCOUNT: "acme", AZURE_STORAGE_KEY: "k" })).toEqual({
      type: "sharedKey",
      accountUrl: "https://acme.blob.core.windows.net",
      accountName: "acme",
      accountKey: "k",
    });
    expect(auth({ AZURE_STORAGE_ACCOUNT: "acme" })).toEqual({
      type: "defaultCredential",
      accountUrl: "https://acme.blob.core.windows.net",
    });
    expect(storageEnvSchema.safeParse(base).success).toBe(false);
  });

  it("rejects unknown drivers", () => {
    expect(storageEnvSchema.safeParse({ STORAGE_DRIVER: "ftp" }).success).toBe(false);
  });
});

describe("objectKey", () => {
  const id = "3f2a9c1e-0b4d-4e8f-9a6b-1c2d3e4f5a6b";

  it("shards by the first four hex digits, under the prefix", () => {
    expect(objectKey(id)).toBe(`3f/2a/${id}`);
    expect(objectKey(id, "out/")).toBe(`out/3f/2a/${id}`);
  });

  it("refuses anything but a UUID", () => {
    expect(() => objectKey("../../etc/passwd")).toThrow();
  });
});
