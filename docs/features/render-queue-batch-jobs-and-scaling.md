---
type: feature
title: Render queue, batch jobs and scaling
description: Renders run as queued jobs on horizontally scaled worker processes; large batches are queued with progress and cancel; admins see queue depth, workers and render-time metrics.
tags: [product, api, admin, scaling, enterprise]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-11T16:07:59Z }
---

# Render queue, batch jobs and scaling

## Summary

Enterprise customers render in bursts and in bulk. Renders run as jobs on worker processes that scale out ([ADR 0020](../adrs/0020-pg-boss-job-queue-and-separate-render-worker-processes.md)). Large jobs are queued as batches with progress. Admins see how the cluster is doing.

## Motivation

A month-end run of 10,000 statements must not time out or slow down someone filling a form. Operations teams need to see queue depth, render times and failures, and add capacity without code changes.

## Behavior

- **Queued renders.** Every logged render ([generation log](generation-log.md)) is a job. Synchronous [API](html-to-pdf-api.md) and app calls wait for it and return the PDF; past the wait timeout they return `202` with the generation id.
- **Async mode.** Any generate call can ask for async: it returns the generation id at once. The caller polls it or gets a [webhook](webhooks.md).
- **Batch jobs.** One request generates many documents from one published template: a JSON array (API) or a CSV upload (app). The batch has a status, progress (done / failed / total), per-row generations, and a cancel action. Output: one ZIP of PDFs, one combined [packet](combining-pdfs-into-packets.md), or individual downloads. Invalid rows fail alone; the rest continue.
- **Priorities.** Interactive renders go ahead of batch rows.
- **Retries.** A job lost to a worker or browser crash retries automatically; the attempt count is logged. Template or data errors don't retry.
- **Timing on every render**, stored on the generation: queue wait, Liquid, Chromium, bands, stamping/overlay, total. Shown in the generation detail and filterable/sortable in the log.
- **Workers.** Each worker reports a heartbeat: host, process id, version, concurrency, jobs running, event-loop lag. Admin > System lists workers online and warns when there are none.
- **Metrics (Admin > System):** renders per minute, p50/p95/p99 render time, error rate, and queue depth by priority, over selectable windows; breakdown by source and template.
- **Scaling** is configuration only: `ROLE` and `RENDER_CONCURRENCY` (see ADR 0020). Health endpoints report role and readiness for load balancers and orchestrators.

## Acceptance criteria

- [ ] With `ROLE=api` and two `ROLE=worker` processes, renders from the app and API complete, and the log shows both workers' ids.
- [ ] Killing a worker mid-render retries the job on another worker; the generation shows 2 attempts.
- [ ] A 500-row batch completes with progress visible in the app, can be cancelled mid-run, and downloads as a ZIP and as a packet.
- [ ] A batch row with invalid data fails with field errors while the other rows succeed.
- [ ] An interactive render submitted during a running batch starts before the remaining batch rows.
- [ ] Every generation shows its timing breakdown; the log sorts by total and by queue wait.
- [ ] Admin > System shows workers, queue depth and p50/p95 render times.

## Known limitations

- Synchronous renders pay queue pickup latency (pg-boss polling); it's shown as queue wait.
- Postgres carries the queue; very high volumes will need a dedicated queue later.
- Batch input is capped by the 20 MB request limit (the CSV or JSON array, not the outputs).

## Open questions

- Per-user or per-key rate limits and quotas.
- Autoscaling hints (e.g. exposing queue depth as a Prometheus metric).
