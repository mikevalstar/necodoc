---
type: adr
title: pg-boss job queue and separate render worker processes
description: Every logged render runs as a pg-boss job on the existing Postgres, consumed by render worker processes that scale horizontally; API nodes enqueue and, for synchronous calls, wait for the result.
tags: [architecture, api, pdf, scaling]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-11T16:07:59Z }
---

# pg-boss job queue and separate render worker processes

## Status

Accepted. Builds on [ADR 0012](0012-headless-chromium-for-html-to-pdf.md) (the renderer) and [ADR 0006](0006-postgres-with-drizzle.md) (the database). Scope: [Render queue, batch jobs and scaling](../features/render-queue-batch-jobs-and-scaling.md).

## Context

We target enterprise customers. They send bursts (month-end statements, thousands of policies), want large batches queued rather than timed out, and want every render's timing and outcome on record.

Today a render runs inside the API request that asked for it. One API node owns one Chromium, so throughput is capped by that node, a burst blocks interactive users, and a crash loses in-flight work.

Node `worker_threads` don't solve this. Chromium already renders in its own process, and threads don't spread work across machines. What scales is a durable queue that any number of worker processes consume.

## Decision

- **pg-boss** on the existing Postgres is the job queue. No Redis, no new service to run.
- **Two process roles from one codebase**, chosen by `ROLE`:
  - `api`: serves HTTP, enqueues jobs, never launches Chromium for logged renders.
  - `worker`: consumes render jobs, owns one Chromium with `RENDER_CONCURRENCY` contexts.
  - `all` (default in dev) runs both in one process.
  Scale by running more worker processes, on any number of machines.
- **Every logged render is a job**: app generations, API calls, share links, packets, batch rows, re-runs. Job payloads carry ids only; the input lives on the generation row.
- **Synchronous calls wait.** The API node enqueues, waits for completion up to a timeout, and returns the PDF. Past the timeout it answers `202` with the generation id to poll. Interactive jobs have higher priority than batch jobs.
- **Live previews stay in-process** on API nodes. They aren't logged, and queue pickup latency would make editing feel slow. API nodes bound them with their own small concurrency limit.
- **Retries** cover infrastructure failures (browser crash, worker lost mid-job). Template and data errors fail once and are logged as errors.
- **Webhook delivery** is a pg-boss queue too, so retries survive restarts.
- **Scheduled maintenance** (log retention) runs as pg-boss cron jobs, so it runs once per cluster, not once per node.
- **No `worker_threads`** for now. Workers report event-loop lag; if PDF stamping shows up as blocking, move it to a thread then.

## Alternatives considered

- **BullMQ + Redis.** Mature and fast, but adds Redis to every deployment.
- **graphile-worker.** Also Postgres-backed and fast. pg-boss has priorities, retries with backoff, cron scheduling and singleton jobs built in, which this design uses.
- **In-process only, scale API nodes.** Simple, but a batch of 10,000 still lands on one node's request, and nothing survives a crash.
- **`worker_threads` pool.** Parallelises CPU work on one machine; doesn't help Chromium-bound work or horizontal scale.

## Consequences

- Throughput grows by adding worker processes; API nodes stay responsive during bursts.
- Synchronous renders pay queue pickup latency (pg-boss polling). It's recorded per generation as queue wait so it's visible.
- Postgres carries the queue as well as the data. It's the ceiling we'd hit first; moving to a dedicated queue later only changes the enqueue and consume code.
- Deployments need at least one worker (or a node with `ROLE=all`), or logged renders wait forever. Health shows workers online.
