---
type: adr
title: Container images, Compose and Helm for self-hosting
description: necodoc ships as two images from one Dockerfile (the API, whose ROLE picks api, worker or both, and an nginx image that serves the SPA and proxies /api), run with Docker Compose on one host or the Helm chart on Kubernetes. Postgres is brought by the operator; migrations are an explicit step.
tags: [architecture, deployment, scaling, enterprise]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T18:00:28Z }
---

# Container images, Compose and Helm for self-hosting

## Status

Accepted. Scope: [Self-hosting](../features/self-hosting.md). Packages the
process roles of
[ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md) and
the storage drivers of
[ADR 0023](0023-generated-outputs-in-object-storage.md).

## Context

Every customer self-hosts ([competitive scope](../features/competitive-scope.md)).
They run anything from one VM to a Kubernetes cluster with autoscaled render
workers. The API process needs a Chromium build that matches its
`playwright-core` version exactly; getting that wrong on a host is the most
likely install failure. Operators already run Postgres their own way (managed
service, operator, VM) and want to keep doing so.

## Decision

- **One [Dockerfile](../../Dockerfile), two runtime targets.**
  - `api`: Node 24 slim with the bundled API (`pnpm deploy --prod`, production
    deps only), the Chromium headless shell installed by the image's own
    `playwright-core` (so the revision always matches), its system libraries
    and fonts, and tini to reap Chromium's processes. Runs as the `node` user,
    has a `HEALTHCHECK` on `/api/health`. `ROLE` picks api, worker or all, so
    the same image is the API and the worker.
  - `app`: unprivileged nginx serving the built SPA with `/api` proxied to the
    API ([nginx template](../../deploy/docker/nginx.conf.template)), so the app
    and auth cookies stay same-origin.
  - `site`: the static marketing site, for whoever hosts it. Self-hosters
    don't need it.
- **Migrations are explicit.** The image's entrypoint
  ([docker-entrypoint.sh](../../deploy/docker/docker-entrypoint.sh)) runs
  `migrate` (Drizzle's migrator over the committed `apps/api/drizzle` folder,
  [migrate.mjs](../../deploy/docker/migrate.mjs)) or `storage-migrate` as
  commands. Boot doesn't migrate unless `MIGRATE_ON_START=true`. Compose runs
  a one-shot `migrate` service before the API; Helm runs a pre-install and
  pre-upgrade hook Job.
- **[Compose](../../deploy/compose/docker-compose.yml)** for one host:
  Postgres, migrate, api, worker (scale with `--scale worker=N`), app, and
  optional `minio` (Chainguard's source build; MinIO no longer publishes
  images) and `site` profiles. Disk storage is a named volume shared
  by api and workers.
- **[Helm chart](../../deploy/helm/necodoc)** for Kubernetes: api, worker and
  app Deployments, Services, Ingress (`/api` to the API, the rest to the
  app), a ConfigMap and Secret for the env (or an existing Secret), probes on
  `/api/health` and `/api/health/ready`, PodDisruptionBudgets, a CPU HPA for
  workers, an optional KEDA ScaledObject on pg-boss queue depth, the
  migration Job, and a ReadWriteMany PVC when the disk driver is used. Pods
  run as non-root with a read-only root filesystem and no capabilities.
- **Postgres is not bundled in Helm.** The chart takes a `DATABASE_URL`.
  Compose bundles one because a single-host install wants one command.
- **Operator docs live in the developer docs site**
  ([ADR 0026](0026-astro-starlight-for-the-developer-docs-site.md)), not in
  this bundle.

## Alternatives considered

- **Separate api and worker images.** The worker needs Chromium and the API
  needs it for previews, so the images would be nearly identical. One image
  keeps versions in lockstep.
- **Migrate on every boot.** Simple, but several replicas race at startup and
  a bad migration takes every pod down at once. Kept as an opt-in flag for
  single-container installs.
- **`drizzle-kit migrate` in the image.** Pulls drizzle-kit and the API's
  env validation into production. `drizzle-orm`'s migrator, already a
  production dependency, reads the same folder and journal table.
- **Bundled Postgres subchart.** Locks operators into one chart's way of
  running Postgres (and Bitnami's images are no longer freely published).
  CloudNativePG or a managed service is the documented path.
- **Caddy for the app image.** Equally small; nginx's unprivileged image and
  `envsubst` templates are more familiar to the operations teams we target.

## Consequences

- An upgrade is: pull the new tag, run `migrate`, roll the pods. Migrations
  must stay backwards-compatible with the previous release while pods roll.
- The `api` image is large (Chromium and fonts, roughly 1 GB uncompressed);
  that's the cost of rendering locally.
- The chart-managed Secret is a hook too (so the migration Job can read it on
  install), which means `helm uninstall` leaves it behind.
- KEDA scaling reads pg-boss's job table, so a pg-boss major upgrade may need
  the query adjusted (as the live queue view already does).
