---
type: feature
title: Self-hosting
description: Operators run necodoc on their own infrastructure from published container images, with Docker Compose on one host or a Helm chart on Kubernetes, and documented upgrades, scaling, backups and recovery.
tags: [product, deployment, scaling, enterprise]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T18:00:28Z }
---

# Self-hosting

## Summary

Every customer runs their own necodoc
([competitive scope](competitive-scope.md)). An operator goes from nothing to
a working install, then scales, upgrades and recovers it, without reading the
source. How it's packaged: [ADR 0025](../adrs/0025-container-images-compose-and-helm-for-self-hosting.md).

## Motivation

Enterprise IT teams evaluate on their own hardware first. If the first
install fails on a Chromium library or a missing migration, the evaluation
ends. Production teams then need to know how to scale renders, where the
data lives, and how to get it back.

## Behavior

- **One host:** copy the Compose `.env.example`, set the secrets, `docker
  compose up`. Postgres, migrations, API, a worker and the app come up; the
  first account to sign up is the admin.
- **Kubernetes:** `helm install` with a `DATABASE_URL` and a secret. API,
  workers and app run as separate Deployments behind one Ingress.
- **Scaling** is configuration: more worker replicas (by hand, CPU HPA, or
  queue depth with KEDA). See the
  [render queue](render-queue-batch-jobs-and-scaling.md) spec.
- **Storage** is any of the drivers in
  [ADR 0023](../adrs/0023-generated-outputs-in-object-storage.md); disk needs
  a volume every API and worker shares.
- **Upgrades** are explicit: new image tag, run migrations, roll pods.
- **Sign-in** is email and password, single sign-on through the customer's
  IdP, or both, set in env ([Single sign-on](single-sign-on.md)).
- **Health:** liveness and readiness endpoints for load balancers and
  orchestrators; readiness fails without the database, the queue or storage.
- **Operator documentation** (env reference, scaling, storage, backups and
  DR, upgrades, SSO setup) is in the developer docs site
  ([ADR 0026](../adrs/0026-astro-starlight-for-the-developer-docs-site.md)),
  [self-hosting section](../../apps/devdocs/src/content/docs/self-hosting).

## Implementation

- Images: [Dockerfile](../../Dockerfile), entrypoint and migration runner in
  [deploy/docker](../../deploy/docker).
- Compose: [deploy/compose](../../deploy/compose/docker-compose.yml).
- Helm: [deploy/helm/necodoc](../../deploy/helm/necodoc/values.yaml).

## Acceptance criteria

- [x] The `api`, `app` and `site` images build from a clean checkout.
- [x] `docker compose up` from the example env reaches a ready API; the first
      sign-up is admin and can render a PDF through the app's proxy.
- [x] `docker compose up --scale worker=2` shows two workers online.
- [x] `helm lint` passes and `helm template` renders with the defaults, with
      disk storage on a PVC, and with S3 and KEDA enabled (required secrets set).
- [x] The API image runs as non-root and its Chromium matches its
      `playwright-core`.

## Known limitations

- No bundled Postgres in Helm; bring your own.
- No published image registry yet; operators build the images.
- `helm uninstall` leaves the chart's Secret (it's a hook so migrations can
  read it).
- The chart was verified with `helm lint`, `helm template` and kubeconform,
  not yet on a live cluster.

## Open questions

- Where images are published (GHCR, a customer registry mirror) and signed.
- Prometheus metrics endpoint, so queue depth autoscaling needn't read
  pg-boss's tables.
