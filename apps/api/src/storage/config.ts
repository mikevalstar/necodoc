import { z } from "zod";

// ADR 0023: where generated outputs go. Parsed from the environment in src/env.ts; kept free of
// SDK imports so it can be tested on its own.

/** Unset and blank (`S3_ENDPOINT=` in a .env file) both mean "not set". */
const optional = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

/** Normalised to "" or a path ending in "/", so keys are `${prefix}${shard}`. */
const prefix = optional.transform((value) => (value ? `${value.replace(/^\/+|\/+$/g, "")}/` : ""));

const disk = z
  .object({
    STORAGE_DRIVER: z.literal("disk").default("disk"),
    /** Relative to the API's working directory (apps/api under the pnpm scripts). */
    STORAGE_DIR: optional.default("./data/files"),
  })
  .transform((e) => ({ driver: "disk" as const, dir: e.STORAGE_DIR }));

const s3 = z
  .object({
    STORAGE_DRIVER: z.literal("s3"),
    S3_BUCKET: z.string().min(1),
    /** R2 uses `auto`. */
    S3_REGION: optional.default("us-east-1"),
    /** For MinIO, R2 and other S3-compatible stores; unset for AWS. */
    S3_ENDPOINT: z.preprocess((value) => (value === "" ? undefined : value), z.url().optional()),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    STORAGE_PREFIX: prefix,
    /** Unset: the AWS default credential chain (env, profile, IAM role). */
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_SESSION_TOKEN: optional,
    S3_SSE: z.enum(["AES256", "aws:kms"]).optional(),
    S3_KMS_KEY_ID: optional,
  })
  .refine((e) => !e.S3_ACCESS_KEY_ID === !e.S3_SECRET_ACCESS_KEY, {
    message: "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither",
  })
  .refine((e) => !e.S3_KMS_KEY_ID || e.S3_SSE === "aws:kms", {
    message: "S3_KMS_KEY_ID needs S3_SSE=aws:kms",
  })
  .transform((e) => ({
    driver: "s3" as const,
    bucket: e.S3_BUCKET,
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    prefix: e.STORAGE_PREFIX,
    credentials:
      e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: e.S3_ACCESS_KEY_ID,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            sessionToken: e.S3_SESSION_TOKEN,
          }
        : undefined,
    encryption: e.S3_SSE
      ? e.S3_SSE === "aws:kms"
        ? { type: "aws:kms" as const, kmsKeyId: e.S3_KMS_KEY_ID }
        : { type: "AES256" as const }
      : undefined,
  }));

export type AzureAuth =
  | { type: "connectionString"; connectionString: string }
  | { type: "sharedKey"; accountUrl: string; accountName: string; accountKey: string }
  /** DefaultAzureCredential: managed identity, workload identity, `az login`. */
  | { type: "defaultCredential"; accountUrl: string };

const azure = z
  .object({
    STORAGE_DRIVER: z.literal("azure"),
    AZURE_STORAGE_CONTAINER: z.string().min(1),
    STORAGE_PREFIX: prefix,
    AZURE_STORAGE_CONNECTION_STRING: optional,
    AZURE_STORAGE_ACCOUNT: optional,
    AZURE_STORAGE_KEY: optional,
    /** Defaults to https://<account>.blob.core.windows.net. */
    AZURE_STORAGE_ACCOUNT_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
  })
  .transform((e, ctx) => {
    const accountUrl =
      e.AZURE_STORAGE_ACCOUNT_URL ??
      (e.AZURE_STORAGE_ACCOUNT && `https://${e.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`);
    const auth: AzureAuth | undefined = e.AZURE_STORAGE_CONNECTION_STRING
      ? { type: "connectionString", connectionString: e.AZURE_STORAGE_CONNECTION_STRING }
      : accountUrl && e.AZURE_STORAGE_ACCOUNT && e.AZURE_STORAGE_KEY
        ? {
            type: "sharedKey",
            accountUrl,
            accountName: e.AZURE_STORAGE_ACCOUNT,
            accountKey: e.AZURE_STORAGE_KEY,
          }
        : accountUrl
          ? { type: "defaultCredential", accountUrl }
          : undefined;
    if (!auth) {
      ctx.addIssue({
        code: "custom",
        message:
          "Set AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT (with AZURE_STORAGE_KEY, or without it for DefaultAzureCredential)",
      });
      return z.NEVER;
    }
    return {
      driver: "azure" as const,
      container: e.AZURE_STORAGE_CONTAINER,
      prefix: e.STORAGE_PREFIX,
      auth,
    };
  });

export const storageEnvSchema = z.discriminatedUnion("STORAGE_DRIVER", [disk, s3, azure]);

export type StorageConfig = z.output<typeof storageEnvSchema>;

export type StorageDriverName = StorageConfig["driver"];

/**
 * A file's object key: its UUID sharded two levels deep, so no directory (on disk) or listing
 * page (in a bucket) holds more than a sliver of the outputs.
 */
export function objectKey(fileId: string, prefix = "") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fileId)) {
    throw new Error(`Not a file id: ${fileId}`);
  }
  return `${prefix}${fileId.slice(0, 2)}/${fileId.slice(2, 4)}/${fileId}`;
}
