---
title: Self-hosting overview
description: What a necodoc install is made of, what it needs, and which deployment to pick.
sidebar:
  order: 1
  label: Overview
---

necodoc runs on your infrastructure. An install is a few processes around one Postgres database.

## What runs

| Piece | Image | Does |
| --- | --- | --- |
| API | `necodoc-api`, `ROLE=api` | Serves `/api`, the session auth and live previews. Enqueues every logged render. |
| Worker | `necodoc-api`, `ROLE=worker` | Pulls render jobs from the queue and runs Chromium. Scale these. |
| App | `necodoc-app` | Serves the web app and proxies `/api` to the API, so they share one origin. |
| Postgres | yours | Users, templates, assets, the generation log and the job queue (pg-boss). |
| Output storage | yours | Generated PDFs: a shared disk, an S3-compatible bucket, or Azure Blob. See [Storage](/self-hosting/storage/). |

The API and worker are the same image. `ROLE=all` runs both in one process, which is fine for a single small container. See [Roles and scaling](/self-hosting/roles-and-scaling/).

The `necodoc-api` image bundles the Chromium headless shell that its Playwright version expects, with the system libraries and fonts it needs, so the host needs nothing besides a container runtime.

## Requirements

- A container runtime: Docker with Compose v2, or Kubernetes 1.27+ with Helm 3.
- Postgres. The images are tested against Postgres 18. The database user must be able to create schemas: migrations create the app's tables, and pg-boss creates its own `pgboss` schema on first start.
- Memory: each worker runs one Chromium. Budget about 1 GB per worker at the default `RENDER_CONCURRENCY=2`, and raise it with concurrency.
- A URL people open in the browser. It's `BETTER_AUTH_URL`, and the app and `/api` must be served from it.

## Build the images

There's no public registry yet. Build from a checkout:

```sh
docker build --target api -t necodoc-api:0.1.0 --build-arg APP_VERSION=0.1.0 .
docker build --target app -t necodoc-app:0.1.0 .
```

Push them to your own registry for Kubernetes. A `site` target builds the marketing site; you don't need it.

## Pick a deployment

- [Docker Compose](/self-hosting/docker-compose/): one host, everything included (Postgres too). Good for evaluations and small installs.
- [Kubernetes with Helm](/self-hosting/kubernetes-helm/): separate API, worker and app Deployments, autoscaled workers, your own Postgres.

Then read [Configuration](/self-hosting/configuration/) for every environment variable, and [Backups and disaster recovery](/self-hosting/backups-and-dr/) before you go live.
