---
type: adr
title: Generated outputs in object storage
description: Generated PDFs and other render outputs go to a configured storage driver (local disk, S3-compatible, or Azure Blob) and stream through the API with signed links; uploads, assets and templates stay in Postgres. Extends ADR 0014.
tags: [architecture, data, api, scaling]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T16:50:14Z }
---

# Generated outputs in object storage

## Status

Accepted. Extends [ADR 0014](0014-binary-files-stored-in-postgres.md), which
still holds for base data. Builds on
[ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md)
(workers write the outputs). Behaviour is in the
[generation log](../features/generation-log.md) and
[render queue](../features/render-queue-batch-jobs-and-scaling.md) specs.

## Context

ADR 0014 put every file in a Postgres `bytea` column. Base data (uploaded
overlay PDFs, image and font assets, templates) is small, edited by people,
and must move with the rows that reference it. Generated outputs are
different: they grow with every render, a 10,000-row batch adds gigabytes,
and they bloat the database's backups and replicas. Enterprise deployments
also want outputs in their own bucket, under their own encryption and
lifecycle rules.

## Decision

- **Split by kind.** Base data stays in Postgres (ADR 0014). Generated outputs
  (generation PDFs, and any later render artefact) go to the storage driver.
  Batch ZIPs and packets are built on download from the stored PDFs, not
  stored.
- **One driver per deployment**, picked by `STORAGE_DRIVER` and validated as a
  discriminated union in [env.ts](../../apps/api/src/env.ts):
  - `disk` (default): `STORAGE_DIR`, `./data/files` from the API's working
    directory. Several hosts need a shared mount (NFS, EFS, Azure Files).
  - `s3`: any S3-compatible store (AWS S3, MinIO, Cloudflare R2) through
    `@aws-sdk/client-s3`. Static keys or the AWS default credential chain;
    optional SSE-S3 or SSE-KMS.
  - `azure`: Azure Blob through `@azure/storage-blob` (it isn't
    S3-compatible). Connection string, account key, or `DefaultAzureCredential`
    (managed identity).
- **The `file` row stays the source of truth** for metadata (owner, MIME type,
  size, SHA-256) and records where the bytes are: `db` (bytes in the row) or a
  driver plus key. Both coexist, so existing outputs keep working until the
  migration CLI moves them. Keys are the file's UUID, sharded two levels deep
  (`ab/cd/abcd…`), under an optional prefix.
- **Streaming.** Workers stream outputs to the driver; downloads stream from
  it. Disk writes go to a temp file and are renamed into place, so a reader
  never sees half a file.
- **The API serves every download** after the same permission check as before,
  with ETag (SHA-256), conditional and range requests. A signed link (HMAC
  token with the file id, link id and expiry) lets callers without a session
  download one file until it expires. Opt-in `STORAGE_REDIRECT=presigned`
  answers downloads with a redirect to a short-lived S3 presigned URL or Azure
  SAS instead of proxying the bytes.
- **Object lifecycle follows the row.** Deleting a generation or running
  retention deletes the objects after the rows are gone.
- **Readiness checks the driver** (a probe write, read and delete on disk; a
  bucket or container check otherwise), so a node with a missing mount or bad
  credentials leaves the load balancer.
- **Migration**: `pnpm --filter @necodoc/api storage:migrate` copies generation
  outputs still in Postgres to the driver, verifies the SHA-256 of what it
  stored, then clears the `bytea`. It's resumable.

## Alternatives considered

- **Everything to object storage.** Assets and source PDFs would need the
  driver at render and edit time and a second copy step on every backup
  restore, for data that's small.
- **S3 API only, with an Azure gateway.** Azure Blob has no native S3 API;
  gateways are another service to run.
- **Redirect-only downloads.** Keeps bytes off the API, but loses the API's
  permission check at the moment of download and needs per-driver range and
  caching behaviour. Kept as an opt-in.

## Consequences

- The database stops growing with output volume; operators bring their own
  bucket, encryption and backup policy.
- Rows and objects can drift: a crash between writing an object and committing
  its row leaves an orphan object, and a failed object delete after the row is
  gone leaves one too. Both are logged; a sweeper is future work.
- Moving between drivers (say disk to S3) isn't automated; the migration CLI
  only moves outputs out of Postgres.
- Changing a prefix or `STORAGE_DIR` affects new objects only; keys already
  stored keep theirs.
