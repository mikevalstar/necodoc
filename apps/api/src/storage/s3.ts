import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DriverConfig, StorageDriver } from "./index";

// ADR 0023: AWS S3 and S3-compatible stores (MinIO, Cloudflare R2, ...).

export function s3Driver(config: DriverConfig<"s3">): StorageDriver {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    // Unset falls back to the default chain: env, shared profile, IAM role.
    credentials: config.credentials,
    // Some S3-compatible stores reject the newer default checksums on plain puts and gets.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;
  const encryption = config.encryption && {
    ServerSideEncryption: config.encryption.type,
    ...(config.encryption.type === "aws:kms" && config.encryption.kmsKeyId
      ? { SSEKMSKeyId: config.encryption.kmsKeyId }
      : {}),
  };

  return {
    name: "s3",
    target: `s3://${Bucket}/${config.prefix}${config.endpoint ? ` at ${config.endpoint}` : ""}`,
    prefix: config.prefix,
    async put(key, body, contentType) {
      // Multipart past 5 MB, so the stream never has to be buffered whole.
      await new Upload({
        client,
        params: { Bucket, Key: key, Body: body, ContentType: contentType, ...encryption },
      }).done();
    },
    async get(key, range) {
      const { Body } = await client.send(
        new GetObjectCommand({
          Bucket,
          Key: key,
          Range: range && `bytes=${range.start}-${range.end}`,
        }),
      );
      if (!(Body instanceof Readable)) throw new Error(`S3 returned no body for ${key}`);
      return Body;
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const { Errors } = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (Errors?.length) {
          throw new Error(`S3 delete failed for ${Errors.length} objects: ${Errors[0]?.Message}`);
        }
      }
    },
    async check() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
    presign(key, { expiresInSeconds, contentType, contentDisposition }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDisposition,
        }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
}
