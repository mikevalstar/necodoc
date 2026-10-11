---
title: Docker Compose
description: Run necodoc on one host with Docker Compose, including Postgres, migrations, workers and optional MinIO.
sidebar:
  order: 2
---

[`deploy/compose/docker-compose.yml`](https://github.com/mikevalstar/necodoc/blob/main/deploy/compose/docker-compose.yml) runs the whole stack on one host:

- `postgres`: Postgres 18, data in the `pgdata` volume.
- `migrate`: applies database migrations, then exits. `api` and `worker` wait for it to succeed.
- `api` (`ROLE=api`) and `worker` (`ROLE=worker`), sharing the `files` volume for disk storage.
- `app`: the web app on `APP_PORT` (default 8080), proxying `/api` to `api`.
- Profiles: `minio` (S3-compatible storage) and `site` (the marketing site).

## Start

From `deploy/compose`:

```sh
cp .env.example .env
# Set POSTGRES_PASSWORD and BETTER_AUTH_SECRET (openssl rand -base64 32),
# and BETTER_AUTH_URL to the URL people will open.
docker compose up -d --build
```

`--build` builds the images from the checkout. To use images from a registry instead, set `NECODOC_API_IMAGE` and `NECODOC_APP_IMAGE` in `.env` and drop `--build`.

Open `http://localhost:8080` and sign up. The first account becomes the admin. Check readiness:

```sh
curl http://localhost:8080/api/health/ready
# {"ready":true,"role":"api","database":true,"queue":true,"storage":{"driver":"disk","ok":true},"workersOnline":1}
```

## Scale workers

```sh
docker compose up -d --scale worker=3
```

Admin > System lists each worker. Each one renders `RENDER_CONCURRENCY` jobs at a time.

## S3 storage on MinIO

MinIO no longer publishes container images, so the `minio` profile uses Chainguard's build from MinIO's source. In `.env`, switch the storage block to the S3 lines (they're in `.env.example`), then:

```sh
docker compose --profile minio up -d
```

A `minio-bucket` one-shot creates the bucket. Outputs rendered before the switch stay on the disk volume and can't be downloaded afterwards, so switch before you rely on the install (see [Storage](/self-hosting/storage/#switching-drivers)).

## TLS

The `app` container speaks plain HTTP. Put your TLS proxy (Caddy, Traefik, a load balancer) in front of it, forward everything to `app:8080`, and set `BETTER_AUTH_URL` to the `https://` URL. Allow request bodies of 25 MB and reads of at least 60 seconds on that proxy (see [Configuration](/self-hosting/configuration/#proxies-and-load-balancers)).

## Upgrade

```sh
git pull   # or set new image tags in .env
docker compose up -d --build
```

`migrate` runs again before `api` and `worker` restart. See [Upgrades](/self-hosting/upgrades/).

## Stop and remove

`docker compose down` stops the stack and keeps the volumes. `docker compose down -v` also deletes the database and stored PDFs.
