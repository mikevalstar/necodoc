---
title: Kubernetes with Helm
description: Install necodoc on Kubernetes with the Helm chart, with your own Postgres, storage and autoscaled render workers.
sidebar:
  order: 3
---

The chart is in [`deploy/helm/necodoc`](https://github.com/mikevalstar/necodoc/tree/main/deploy/helm/necodoc). Its [`values.yaml`](https://github.com/mikevalstar/necodoc/blob/main/deploy/helm/necodoc/values.yaml) documents every setting.

## What it installs

- Deployments for `api` (`ROLE=api`), `worker` (`ROLE=worker`) and `app` (the web app), with Services for `api` and `app`.
- An Ingress: `/api` to the API, everything else to the app, on one host.
- A ConfigMap with the non-secret env, and a Secret (or your existing one).
- A migration Job that runs as a `pre-install` and `pre-upgrade` hook, before any new pod starts.
- PodDisruptionBudgets for `api` and `worker`.
- Optional: a CPU HorizontalPodAutoscaler or a KEDA ScaledObject for workers, and a PersistentVolumeClaim for disk storage.

Pods run as non-root (UID 1000; nginx's 101 for the app) with a read-only root filesystem, no Linux capabilities and the `RuntimeDefault` seccomp profile. Chromium doesn't need extra privileges.

The chart doesn't install Postgres. Use a managed service or an operator such as [CloudNativePG](https://cloudnative-pg.io).

## Install

Create a Secret with at least `DATABASE_URL` and `BETTER_AUTH_SECRET`, plus any storage credentials (see [Configuration](/self-hosting/configuration/)):

```sh
kubectl create namespace necodoc
kubectl -n necodoc create secret generic necodoc-env \
  --from-literal=DATABASE_URL='postgres://necodoc:...@db.example.internal:5432/necodoc' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
```

Then a values file:

```yaml
# my-values.yaml
image: { repository: registry.example.com/necodoc-api, tag: "0.1.0" }
appImage: { repository: registry.example.com/necodoc-app, tag: "0.1.0" }
publicUrl: https://necodoc.example.com
secrets: { existingSecret: necodoc-env }
ingress:
  className: nginx
  host: necodoc.example.com
  tls: [{ secretName: necodoc-tls, hosts: [necodoc.example.com] }]
storage:
  driver: s3
  s3: { bucket: necodoc-outputs, region: us-east-1 }
```

```sh
helm install necodoc deploy/helm/necodoc -n necodoc -f my-values.yaml
```

You can put `DATABASE_URL` and `BETTER_AUTH_SECRET` under `secrets:` instead of `existingSecret`. The chart's Secret is a Helm hook, so the migration Job can read it on the first install. Because of that, `helm uninstall` leaves it behind; delete it by hand.

## Ingress

Your controller must allow request bodies of 25 MB (uploads are capped at 20 MB) and upstream reads of at least 60 seconds (synchronous renders wait up to `RENDER_WAIT_MS`). Set those through `ingress.annotations` in your controller's syntax.

## Storage

- `disk`: the chart creates a PVC (or uses `storage.disk.existingClaim`) and mounts it at `/data/files` on every API and worker pod. With more than one pod it must be `ReadWriteMany` (NFS, EFS, Azure Files, CephFS). It has `helm.sh/resource-policy: keep`, so uninstalling keeps your PDFs.
- `s3` and `azure`: no volume. Put keys in the Secret, or leave them out and use workload identity: annotate the chart's ServiceAccount through `serviceAccount.annotations` (IRSA's `eks.amazonaws.com/role-arn`, or `azure.workload.identity/client-id` plus the pod label your setup needs).

Details and examples: [Storage](/self-hosting/storage/).

## Scaling workers

Set `worker.replicas`, or turn on one autoscaler:

```yaml
worker:
  autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 10, targetCPUUtilizationPercentage: 70 }
```

Or scale on the render queue with [KEDA](https://keda.sh) (install KEDA first):

```yaml
worker:
  keda: { enabled: true, minReplicas: 1, maxReplicas: 20, jobsPerReplica: 4 }
```

The ScaledObject counts queued and running jobs on the `render` queue in pg-boss's `pgboss.job` table, using the worker's `DATABASE_URL`. The two are exclusive; KEDA creates its own HPA. See [Roles and scaling](/self-hosting/roles-and-scaling/).

## Probes

API and worker pods have a startup and liveness probe on `/api/health` and a readiness probe on `/api/health/ready`. A pod with no database, queue or storage goes unready. See [Health checks](/self-hosting/health-checks/).

## Upgrade

```sh
helm upgrade necodoc deploy/helm/necodoc -n necodoc -f my-values.yaml --set image.tag=0.2.0 --set appImage.tag=0.2.0
```

The migration Job runs first; if it fails, the upgrade stops before any pod changes. Pods restart when the chart's ConfigMap or Secret changes (checksum annotations); after changing an existing Secret, run `kubectl rollout restart`. See [Upgrades](/self-hosting/upgrades/).
