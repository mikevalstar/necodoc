import { PassThrough, pipeline, Readable } from "node:stream";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
import type { AzureAuth } from "./config";
import type { DriverConfig, StorageDriver } from "./index";

// ADR 0023: Azure Blob Storage (not S3-compatible, so its own SDK). Encryption at rest is the
// storage account's setting.

function serviceClient(auth: AzureAuth) {
  switch (auth.type) {
    case "connectionString":
      return BlobServiceClient.fromConnectionString(auth.connectionString);
    case "sharedKey":
      return new BlobServiceClient(
        auth.accountUrl,
        new StorageSharedKeyCredential(auth.accountName, auth.accountKey),
      );
    case "defaultCredential":
      return new BlobServiceClient(auth.accountUrl, new DefaultAzureCredential());
  }
}

export function azureDriver(config: DriverConfig<"azure">): StorageDriver {
  const service = serviceClient(config.auth);
  const container = service.getContainerClient(config.container);

  return {
    name: "azure",
    target: `${container.url}/${config.prefix}`,
    prefix: config.prefix,
    async put(key, body, contentType) {
      // The SDK copies chunks with Buffer methods; a byte-mode PassThrough turns any Uint8Array
      // chunk (Readable.from([bytes])) into a Buffer.
      const buffers = pipeline(body, new PassThrough(), () => {});
      await container.getBlockBlobClient(key).uploadStream(buffers, 4 * 1024 * 1024, 4, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    },
    async get(key, range) {
      const { readableStreamBody } = await container
        .getBlobClient(key)
        .download(range?.start ?? 0, range && range.end - range.start + 1);
      if (!(readableStreamBody instanceof Readable)) {
        throw new Error(`Azure returned no body for ${key}`);
      }
      return readableStreamBody;
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 16) {
        await Promise.all(
          keys.slice(i, i + 16).map((key) => container.getBlobClient(key).deleteIfExists()),
        );
      }
    },
    async check() {
      await container.getProperties();
    },
    async presign(key, { expiresInSeconds, contentType, contentDisposition }) {
      const blob = container.getBlobClient(key);
      // Clock skew between us and Azure would otherwise void a fresh SAS.
      const startsOn = new Date(Date.now() - 5 * 60_000);
      const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);
      const options = {
        containerName: config.container,
        blobName: key,
        permissions: BlobSASPermissions.parse("r"),
        startsOn,
        expiresOn,
        contentType,
        contentDisposition,
      };
      if (blob.credential instanceof StorageSharedKeyCredential) {
        return `${blob.url}?${generateBlobSASQueryParameters(options, blob.credential)}`;
      }
      // Token credentials (managed identity) sign with a user delegation key instead.
      const delegationKey = await service.getUserDelegationKey(startsOn, expiresOn);
      return `${blob.url}?${generateBlobSASQueryParameters(options, delegationKey, blob.accountName)}`;
    },
  };
}
