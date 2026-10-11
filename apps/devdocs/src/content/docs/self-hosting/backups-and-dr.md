---
title: Backups and disaster recovery
description: What to back up, how to restore, and in which order.
sidebar:
  order: 9
---

necodoc keeps state in two places, plus its secrets. Back up all three.

| What | Where | Holds |
| --- | --- | --- |
| Postgres | your database | Users and sessions, templates and versions, themes, assets and uploaded PDFs, the generation log (inputs, metadata, timings), settings, and the render queue (`pgboss` schema). |
| Output storage | disk volume, bucket or container | Generated PDFs, keyed by file id. |
| Secrets | your secret store | `BETTER_AUTH_SECRET`, `DOWNLOAD_SIGNING_SECRET`, storage credentials. |

Without Postgres, stored PDFs are unreadable blobs with no owner. Without storage, the log is intact but those PDFs can't be downloaded. Postgres matters most.

## Postgres

Use what your platform gives you: point-in-time recovery on a managed service, or continuous WAL archiving (CloudNativePG, pgBackRest, WAL-G). For a plain logical dump:

```sh
pg_dump --format=custom --file=necodoc-$(date +%F).dump "$DATABASE_URL"
# Compose:
docker compose exec -T postgres pg_dump -U necodoc --format=custom necodoc > necodoc-$(date +%F).dump
```

Assets and uploaded PDFs live in the database, so it grows with them; generated outputs don't (they're in storage).

## Output storage

- **S3 / R2 / MinIO**: turn on bucket versioning, and replicate to another region or account if you need to survive losing the bucket. Lifecycle rules should expire old *versions*, not current objects; retention is necodoc's job.
- **Azure Blob**: soft delete and blob versioning, plus object replication or GRS.
- **Disk**: snapshot the volume (EBS, Azure Files, NFS snapshots), or copy it with `rsync`/`restic`.

Back up storage *after* Postgres. A PDF written between the two backups just isn't in the database backup, which is harmless; the other order can leave log entries pointing at PDFs that weren't copied.

## Restore

1. Stop the API and workers (scale to 0), so nothing renders into a half-restored install.
2. Restore Postgres:
   ```sh
   pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" necodoc-2026-10-11.dump
   ```
3. Restore storage to the same bucket, container or path, keeping the key layout (`prefix/ab/cd/<file id>`). If the bucket's name or endpoint changes, update the storage env.
4. Restore the same `BETTER_AUTH_SECRET`. A different one signs everyone out; a different download signing secret voids outstanding download links.
5. Run `migrate` (a no-op for a same-version restore), then start the API and workers. Check `/api/health/ready`.

Jobs that were queued or running at backup time come back with the database. Ones that were running are retried when the queue notices their worker is gone.

Generations whose PDF is missing from storage fail to download. An admin can re-run them from the generation log; re-runs use the same input and template version, but fail if the render used an asset or theme that has since been deleted.

## Retention

Admin > System sets how long generated PDFs, and optionally generation inputs, are kept. Retention runs daily on a worker: it deletes expired PDFs from storage and clears expired inputs, while the log entries stay. Backups taken earlier still hold that data, so keep backup retention in line with the policy.
