---
title: Storage
description: Where generated PDFs are stored, with disk, S3, MinIO, Cloudflare R2 and Azure Blob examples.
sidebar:
  order: 6
---

Generated PDFs go to one storage driver per install, set by `STORAGE_DRIVER`. Everything else (templates, assets, uploaded PDFs, users, the generation log) stays in Postgres. Every API and worker node must reach the same storage: workers write outputs, API nodes stream them to downloads.

Readiness (`/api/health/ready`) checks storage: a probe write, read and delete on disk, a bucket or container check otherwise. A node with a missing mount or bad credentials goes unready.

Object keys are the file's id, sharded two levels deep (`ab/cd/abcd…`), under `STORAGE_PREFIX` if set. Deleting a generation, or running retention, deletes its object.

## Disk

```sh
STORAGE_DRIVER=disk
STORAGE_DIR=/data/files   # the image's default
```

One host: a Docker volume (Compose does this). Several hosts or pods: a shared mount (NFS, EFS, Azure Files, a `ReadWriteMany` PVC). Readiness catches a node without the directory, but not two nodes with separate disks that both pass, so make sure it really is shared.

## AWS S3

```sh
STORAGE_DRIVER=s3
S3_BUCKET=necodoc-outputs
S3_REGION=eu-west-1
# Optional: SSE-KMS with your key
S3_SSE=aws:kms
S3_KMS_KEY_ID=arn:aws:kms:eu-west-1:123456789012:key/...
```

Leave the keys unset to use the AWS default credential chain: an IAM role through IRSA or EKS Pod Identity, an instance profile, or env. The role needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on the bucket.

## MinIO and other S3-compatible stores

```sh
STORAGE_DRIVER=s3
S3_BUCKET=necodoc
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=necodoc
S3_SECRET_ACCESS_KEY=...
```

Create the bucket first. The Compose `minio` profile does it for you.

## Cloudflare R2

```sh
STORAGE_DRIVER=s3
S3_BUCKET=necodoc
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## Azure Blob Storage

Pick one way to authenticate:

```sh
STORAGE_DRIVER=azure
AZURE_STORAGE_CONTAINER=necodoc

# 1. Connection string
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...

# 2. Account and key
AZURE_STORAGE_ACCOUNT=necodocprod
AZURE_STORAGE_KEY=...

# 3. Managed or workload identity (DefaultAzureCredential): the account alone
AZURE_STORAGE_ACCOUNT=necodocprod
```

With an identity, grant it **Storage Blob Data Contributor** on the container. `AZURE_STORAGE_ACCOUNT_URL` overrides the endpoint (sovereign clouds, Azurite).

## Presigned downloads

By default every download streams through the API after its permission check, with ETag and range support. `STORAGE_REDIRECT=presigned` instead redirects to a short-lived S3 presigned URL or Azure SAS, which takes the bytes off the API. Browsers must be able to reach the bucket's endpoint, so it doesn't suit an internal-only `S3_ENDPOINT` such as `http://minio:9000`. With managed identity, Azure SAS URLs are user-delegation SAS, so the identity also needs permission to request a user delegation key.

## Moving outputs

Installs from before object storage existed kept generated outputs in Postgres. `storage-migrate` copies them to the configured driver, checks each copy's SHA-256, then clears them from the database. It's safe to stop and rerun.

```sh
docker compose run --rm api storage-migrate                         # Compose
kubectl -n necodoc exec deploy/necodoc-api -- docker-entrypoint.sh storage-migrate   # Kubernetes
```

It only moves outputs stored in Postgres.

## Switching drivers

Each file row records which driver holds its bytes, and a node only reads through the driver it's configured for. After you change `STORAGE_DRIVER`, outputs written under the old driver fail to download, and deleting them leaves their objects behind. There's no tool to move outputs between drivers yet, so pick the driver before going live.
