---
title: Upgrades and migrations
description: How to upgrade necodoc and apply database migrations.
sidebar:
  order: 8
---

The database schema is managed by migrations in [`apps/api/drizzle`](https://github.com/mikevalstar/necodoc/tree/main/apps/api/drizzle), shipped inside the `necodoc-api` image. The image never migrates on its own unless `MIGRATE_ON_START=true`; you run `migrate` as a step.

## Steps

1. **Back up Postgres** (see [Backups and disaster recovery](/self-hosting/backups-and-dr/)).
2. **Run the new image's migrations**: `docker-entrypoint.sh migrate`, i.e. the image with the `migrate` command. Already-applied migrations are skipped.
3. **Roll the API, worker and app** to the new image tag.

Compose and Helm do steps 2 and 3 for you:

- Compose: `docker compose up -d` (with `--build`, or new tags in `.env`). The `migrate` service runs before `api` and `worker` start.
- Helm: `helm upgrade`. The migration Job is a `pre-upgrade` hook; if it fails, nothing else changes.

Anything else (plain Docker, Nomad, ECS): run a one-off container with the `migrate` command and the same `DATABASE_URL`, wait for it to exit 0, then deploy.

## During a rolling upgrade

Old and new pods run side by side for a while. Admin > System shows each worker's version (`APP_VERSION`), so you can see when the old ones are gone. pg-boss upgrades its own `pgboss` schema when the new version first starts.

## Rolling back

Migrations only go forward. To roll back past a migration, restore the database backup taken in step 1, then deploy the old image.

## Single container

With one `ROLE=all` container and nothing else sharing the database, `MIGRATE_ON_START=true` is a reasonable shortcut: the container migrates, then starts.
