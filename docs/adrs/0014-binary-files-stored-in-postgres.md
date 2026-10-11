---
type: adr
title: Binary files stored in Postgres
description: Uploaded PDFs, image and font assets, and generated PDFs live in a Postgres bytea table with a 20 MB per-file limit; no object storage until we need it.
tags: [architecture, data, api]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T15:36:56Z }
---

# Binary files stored in Postgres

## Status

Accepted. Answers the storage question in
[Filling out a document](../features/filling-out-a-document.md). Builds on
[ADR 0006](0006-postgres-with-drizzle.md).

## Context

necodoc now stores three kinds of files: PDFs uploaded for
[overlay templates](../features/pdf-overlay-templates.md), image and font
[assets](../features/assets.md), and the PDFs it generates (kept by the
[generation log](../features/generation-log.md)). S3 or R2 would add a second
service to run, a second backup, credentials, and files that can drift out of
step with the rows that point at them.

## Decision

- Store file bytes in Postgres, in one `file` table with a `bytea` column, next
  to its metadata: owner, MIME type, size, SHA-256, created time. Other tables
  reference files by id.
- Queries that list files select metadata only. Bytes load only when a file is
  served or rendered.
- **Limit: 20 MB per file**, checked from the request body size before reading
  it (Hono's body limit) and again on the stored bytes. The same cap applies to
  API request bodies.
- Files are written once. Replacing a file creates a new row, so published
  [versions](../features/publishing-and-versions.md) that reference the old one
  keep working.
- The API serves files itself, after the same permission check as the row that
  owns them.

## Consequences

- One database to back up and migrate, and a file can't outlive or miss the
  row that references it.
- The database grows with every generated PDF. Retention and pruning are the
  generation log's problem, and an admin can delete outputs.
- Large files go through Node memory whole. 20 MB keeps that bounded.
- Moving to object storage later means a new ADR, a storage interface in front
  of the `file` table, and a copy job. Keep file access behind one module so
  that move stays small.
