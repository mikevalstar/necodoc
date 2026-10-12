---
title: Roles and scaling
description: How the API and render workers split the work, and how to add render capacity.
sidebar:
  order: 5
---

Every logged render (from the app, a template, a batch row or a re-run) is a job on a queue in Postgres ([pg-boss](https://github.com/timgit/pg-boss)). API processes enqueue jobs; worker processes run them in Chromium. Both come from the same image, and `ROLE` picks:

| `ROLE` | Serves HTTP | Renders queued jobs | Use |
| --- | --- | --- | --- |
| `api` | yes | no | Production API nodes. |
| `worker` | health only | yes | Render capacity. Scale these. |
| `all` | yes | yes | One container, or development. |

A deployment needs at least one `worker` or `all` process, or logged renders wait forever. Readiness reports `workersOnline`, and Admin > System warns when there are none.

## What runs where

- **Synchronous renders** wait on the API node for their job, up to `RENDER_WAIT_MS`, then return the PDF. Past that they return `202` with the generation id. See [Batches and async](/guides/batches-and-async/).
- **Live previews** render on the API node itself, outside the queue, capped at `PREVIEW_CONCURRENCY` per process. API nodes therefore run Chromium too, for previews only.
- **Interactive renders go first.** People waiting on a PDF are prioritised over batch rows.
- **Retries:** a job lost to a crashed worker or browser is retried on another worker (3 attempts in all). A dead worker is noticed by its missed heartbeat after 10 to 20 seconds. Template and data errors don't retry.
- **Scheduled jobs** (log retention) run once per cluster on a process with a worker role.

## Adding capacity

Throughput grows with worker processes × `RENDER_CONCURRENCY`. Each worker holds one Chromium; raise concurrency on bigger machines and add workers to spread across machines.

- Compose: `docker compose up -d --scale worker=N`.
- Helm: `worker.replicas`, a CPU HPA (`worker.autoscaling`) or queue depth with KEDA (`worker.keda`). See [Kubernetes with Helm](/self-hosting/kubernetes-helm/#scaling-workers).

Every API and worker node must reach the same Postgres and the same [output storage](/self-hosting/storage/).

## Watching it

Admin > System shows workers online (host, process, version, concurrency, running jobs, event-loop lag), queue depth by priority, renders per minute and p50/p95/p99 render times. Each generation records its queue wait and render timings.

Workers report `APP_VERSION`, so a rolling deploy shows old and new versions side by side until it finishes.

**Admin › Queue** pauses and resumes a queue (`render`, `webhook`, `detect-fields`, `retention`; `POST /api/system/queue/pause`). Every worker stops fetching its jobs, running ones finish, and new jobs wait until it resumes. The pause survives restarts; `necodoc_queue_paused` reports it ([Observability](/self-hosting/observability/#metrics)).

## Shutdown

On `SIGTERM` a process stops taking jobs, lets running renders finish for up to 15 seconds, and leaves the worker list. Give pods a termination grace period above that (the chart uses 60 seconds for workers). A render cut off anyway is retried elsewhere.

## Limits

- Postgres carries the queue as well as the data; it's the first ceiling at very high volumes.
- Batches are capped at 10,000 rows and 20 MB of input.
