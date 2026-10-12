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
- **Pause and resume (admin).** An admin can pause a pg-boss queue (`render`, `webhook`, `detect-fields`, `retention`) from Admin > Queue. Every worker stops picking up its jobs within a few seconds; running jobs finish. The paused state lives in Postgres, so it holds across every worker and across restarts until someone resumes. Jobs keep queuing meanwhile. While `render` is paused, synchronous renders return `202` with the generation id at once instead of waiting out the timeout. Paused queues show on Admin > Queue, Admin > System and in the `necodoc_queue_paused` metric. Pausing and resuming are audit-logged.
- **Retry in place (admin).** A failed render job (out of attempts) can be retried from Admin > Queue: the same job and the same generation entry go back to queued with one more attempt, and the attempt count carries on. Unlike Re-run, no new generation entry is created. "Retry all failed" does the same for every failed render job in the current queue filter, after a confirmation. A retried batch row reopens its batch until it finishes. Retries are audit-logged.
- **Timing on every render**, stored on the generation: queue wait, Liquid, Chromium, bands, stamping/overlay, total. Shown in the generation detail and filterable/sortable in the log.
- **Workers.** Each worker reports a heartbeat: host, process id, version, concurrency, jobs running, event-loop lag. Admin > System lists workers online and warns when there are none.
- **Metrics (Admin > System):** renders per minute, p50/p95/p99 render time, error rate, and queue depth by priority, over selectable windows; breakdown by source and template.
- **Configuration (Admin > System):** what the answering API process is set up with, so an admin can check a deployment without shell access. No secrets. Chromium version; AI on or off and its model; SSO providers (id, protocol), password sign-in and trusted-header sign-in on or off; the certifying certificate (subject, issuer, expiry, warning under 30 days; a load error if it can't be read) and the timestamp authority's host; the storage driver with a live reachability check; the metrics port; OpenTelemetry export and the endpoint's host; log level and format; retention. Each shows an ok, warn or off pill.
- **Operator metrics, logs and traces** for external monitoring: [Observability](observability.md).
- **Output storage.** Workers write each PDF to the storage driver (`STORAGE_DRIVER`: disk, S3-compatible or Azure Blob, see [ADR 0023](../adrs/0023-generated-outputs-in-object-storage.md)). Every API node must reach the same storage: one bucket or container, or a shared mount for disk. Admin > System shows the active driver.
- **Scaling** is configuration only: `ROLE` and `RENDER_CONCURRENCY` (see ADR 0020). Health endpoints report role and readiness for load balancers and orchestrators; readiness fails when the node can't write and read its storage.

## Implementation

- Process roles, env and shutdown: [index.ts](../../apps/api/src/index.ts), [env.ts](../../apps/api/src/env.ts). `pnpm --filter @necodoc/api worker` starts a worker locally.
- Queue setup and the finished-generation channel: [queue.ts](../../apps/api/src/queue.ts). Synchronous callers wake on a Postgres `NOTIFY` when their generation finishes, so pickup is milliseconds, not a poll interval.
- Enqueue, wait, preview and the worker's run of one job: [generate.ts](../../apps/api/src/generate.ts). Rows and their jobs are written in one transaction. Previews skip the queue and are capped by `PREVIEW_CONCURRENCY`.
- Worker loop, heartbeats, retention schedule: [worker.ts](../../apps/api/src/worker.ts). Each render slot fetches its next job the moment it finishes one and only waits (for NOTIFY or the poll) once a fetch comes back empty, so a batch runs at render speed, not poll speed: [queue-slots.ts](../../apps/api/src/queue-slots.ts).
- Storage drivers: [storage/](../../apps/api/src/storage/index.ts); file rows and their locations: [files.ts](../../apps/api/src/files.ts); downloads, ranges and signed links: [download.ts](../../apps/api/src/download.ts); moving old outputs out of Postgres: [storage-migrate.ts](../../apps/api/src/storage-migrate.ts). Retry rules: [errors.ts](../../apps/api/src/render/errors.ts).
- Chromium: [browser.ts](../../apps/api/src/render/browser.ts). Each render gets one fresh locked-down context and page ([ADR 0012](../adrs/0012-headless-chromium-for-html-to-pdf.md)) and prints its body and bands on that page one after another, then closes it. A new page starts a Chromium renderer process, which costs more than printing a short document, so a render opens one page, not one per band. The process caps open contexts at `RENDER_CONCURRENCY` plus `PREVIEW_CONCURRENCY`.
- Timing: [render.ts](../../apps/api/src/render/render.ts) reports Liquid (body), Chromium (body pass), bands (their Liquid and print), and stamping (pdf-lib load, stamp, save). The worker adds queue wait (queued to the last attempt's start), run time and total (queued to finished).
- Routes: [render](../../apps/api/src/routes/render.ts), [batches](../../apps/api/src/routes/batches.ts), [system and live queue](../../apps/api/src/routes/system.ts), [health](../../apps/api/src/routes/health.ts). CSV parsing and column mapping: [batch.ts](../../packages/shared/src/batch.ts).
- App: [Admin › System](../../apps/app/src/routes/_app/admin/system.tsx), [batches](../../apps/app/src/routes/_app/batches/index.tsx).

## Acceptance criteria

- [ ] With `ROLE=api` and two `ROLE=worker` processes, renders from the app and API complete, and the log shows both workers' ids. (Verified with a `ROLE=all` node plus two workers, and a separate `ROLE=api` node whose renders the workers ran; `/api/v1` doesn't exist yet.)
- [x] Killing a worker mid-render retries the job on another worker; the generation shows 2 attempts.
- [x] A 500-row batch completes with progress visible in the app, can be cancelled mid-run, and downloads as a ZIP and as a packet. (500 rows completed through the API with ZIP and 1,000-page packet; a 301-row CSV batch cancelled mid-run in the app.)
- [x] A batch row with invalid data fails with field errors while the other rows succeed.
- [x] An interactive render submitted during a running batch starts before the remaining batch rows.
- [x] Every generation shows its timing breakdown; the log sorts by total and by queue wait.
- [x] Admin > System shows workers, queue depth and p50/p95 render times.
- [x] Pausing `render` with a small batch running lets the running rows finish and starts no more until it's resumed, on every worker and across a restart. (A 20-row batch on two workers: the 4 running rows finished, 12 waited; a worker started while paused consumed everything but `render`.)
- [x] Retrying a failed render job reuses its generation entry (no new entry) and shows the extra attempt.
- [ ] Admin > System shows the configuration with no secret in the response, and warns about a certificate expiring within 30 days.

## Known limitations

- Synchronous renders pay queue pickup latency; it's shown as queue wait. With an idle worker it's a few milliseconds (NOTIFY wakes it).
- Postgres carries the queue; very high volumes will need a dedicated queue later.
- Batch input is capped by the 20 MB request limit (the CSV or JSON array, not the outputs) and 10,000 rows.
- Idle slots poll twice a second (pg-boss's minimum) as a backstop to NOTIFY; a job queued by a retry delay rather than an insert waits for that poll.
- A killed worker's job is detected by its missed heartbeat: 10–20 s before the retry starts.
- Render timeouts count as template errors and don't retry. A job that loses its worker three times fails.
- Each batch row stores its own copy of the compiled template as its input, so large batches take space.
- Cancelling stops rows that haven't started; running rows finish. Cancelling a single queued job (live queue) drops a running render's result rather than stopping Chromium.
- The packet download is built in memory; the ZIP streams. Neither is stored; both are rebuilt from the stored PDFs on each download.
- With `STORAGE_DRIVER=disk` and more than one host, the directory must be a shared mount; readiness catches a node without it, not two nodes with separate disks that both pass.
- Metrics come from the generation log, so deleted entries drop out of them.
- Configuration is the answering API process's own environment. Workers read theirs separately (certification runs on workers), so a worker with different `CERTIFY_*` settings isn't shown.
- The live queue view reads pg-boss's `pgboss.job` table directly (pg-boss has no listing API), so a pg-boss major upgrade may need it adjusted.
- When the app's Render or template page waits past the timeout, it gets the 202 body instead of a PDF.
- `render` is one queue with priorities, so interactive and batch renders pause together; pausing only batch rows would need separate queues. `render-lost` (dead letters) can't be paused.
- Retry in place covers render jobs only; failed webhook and detection jobs aren't retried from the queue view. A retried generation fires its `generation.*` webhook again when it finishes.
- Workers also re-read the paused queues on every heartbeat (5 s), in case they missed the pause notification.

## Open questions

- Per-user quotas. (Per-key rate limits exist: [HTML to PDF API](html-to-pdf-api.md#limits-and-logging).)
- Autoscaling on Prometheus metrics (queue depth and age, worker slots are exported: [observability](observability.md)); the chart scales on KEDA's Postgres query today.
