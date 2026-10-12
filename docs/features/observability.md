---
type: feature
title: Observability
description: Operators get structured JSON logs, a Prometheus metrics endpoint and opt-in OpenTelemetry traces from every API and worker process, so necodoc plugs into the monitoring stack they already run.
tags: [product, deployment, scaling, enterprise, observability]
status: draft
generated: { by: okq/0.9.0, at: 2026-10-12T06:00:15Z }
---

# Observability

## Summary

Every necodoc process logs JSON to stdout, serves Prometheus metrics, and,
when an OpenTelemetry endpoint is configured, traces a render from the HTTP
request through the queue into the worker. Mechanism:
[ADR 0036](../adrs/0036-pino-logs-prometheus-metrics-and-opt-in-opentelemetry-traces.md).

## Motivation

Enterprise operations teams run their own Datadog, Grafana, Splunk or
Elastic. They want to alert on queue depth and render errors, find every log
line for one failing request, and see where a slow render spent its time,
without opening the app. Admin > System
([render queue](render-queue-batch-jobs-and-scaling.md)) answers that for
people; this answers it for their tooling.

## Behavior

- **Logs.** One JSON object per line, `LOG_LEVEL` (default `info`) and
  `LOG_FORMAT` (`json` in production, readable `pretty` in development).
  - Every request: request id, method, path, route, status, duration, user id
    or API key id, client address. Health checks log at `debug`.
  - Every line written during a request carries its request id; with tracing
    on, lines also carry `trace_id` and `span_id`.
  - Every logged render ([generation log](generation-log.md)): generation id,
    mode, status, attempt, worker, page count, size, queue wait, run time and
    the Liquid / Chromium / bands / stamping breakdown. Failures log the
    error. Previews log at `debug`.
  - Every queue job: queue, job id, duration; failures at `warn`.
  - Unhandled errors log with their stack and the request id.
  - Secrets (passwords, tokens, cookies, authorization headers) are
    redacted. Field values are never logged: `data`, `input` and `fields`
    are redacted wherever they appear, and render errors in logs and spans
    have the input's values masked
    ([personal data masking and erasure](personal-data-masking-and-erasure.md)).
- **Metrics.** `METRICS_PORT` turns on a Prometheus `/metrics` listener on
  every role. It's a separate port so it's never reachable through the public
  `/api` proxy; operators limit who can reach the port. Metrics:
  - HTTP requests by method, route and status, with durations.
  - Render durations by mode (`html`, `overlay`, `combine`), kind
    (`generation`, `preview`) and status; Chromium/Liquid/bands/stamp phase
    durations; queue wait.
  - Queue jobs by queue and state (ready, deferred, active, failed) and the
    oldest ready job's age, for every pg-boss queue.
  - Worker job durations by queue and status, renders running and render
    slots per process.
  - Build info (version, role) and Node process metrics (CPU, memory, event
    loop lag, GC).
- **Traces.** Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` (or
  `OTEL_TRACES_EXPORTER`) is set; then the standard `OTEL_*` variables apply.
  An API request is one trace: the HTTP span, the job it queued, the worker's
  processing of that job, the render (Liquid, Chromium passes, bands,
  stamping) and the storage write. An incoming W3C `traceparent` is
  continued. Off means no SDK loaded and no overhead.
- **Deploy.** The Helm chart sets the metrics port, adds Prometheus scrape
  annotations and can create a Prometheus Operator `PodMonitor`. Compose has
  a `monitoring` profile with Prometheus and Jaeger for trying it on one host.
  ([Self-hosting](self-hosting.md).)

## Implementation

- Logger and redaction: [observability/logger.ts](../../apps/api/src/observability/logger.ts), [log.ts](../../apps/api/src/log.ts).
- Metrics and the listener: [observability/metrics.ts](../../apps/api/src/observability/metrics.ts); queue gauges in [queue.ts](../../apps/api/src/queue.ts), worker gauges in [worker.ts](../../apps/api/src/worker.ts).
- Tracing: [observability/tracing.ts](../../apps/api/src/observability/tracing.ts).
- Request log, metrics and span: [observability/http.ts](../../apps/api/src/observability/http.ts). Render and job instrumentation: [generate.ts](../../apps/api/src/generate.ts), [render.ts](../../apps/api/src/render/render.ts), [worker.ts](../../apps/api/src/worker.ts).
- Env: [env.ts](../../apps/api/src/env.ts). Deploy: [Helm values](../../deploy/helm/necodoc/values.yaml), [Compose](../../deploy/compose/docker-compose.yml).

## Acceptance criteria

- [x] With `LOG_FORMAT=json`, every API request and every render writes one JSON line with the fields above.
- [x] `curl :$METRICS_PORT/metrics` on an api and a worker process returns HTTP, render, queue and process metrics.
- [ ] With an OTLP endpoint set, one synchronous render shows as one trace spanning API and worker.
- [ ] With no `OTEL_*` set, the OpenTelemetry SDK is not loaded.
- [x] The Helm chart renders a `PodMonitor` when enabled.

## Known limitations

- The metrics port has no authentication; it relies on not being exposed.
- Queue metrics are cluster-wide and identical on every process; aggregate with `max`.
- No spans for Postgres queries or outbound HTTP calls (webhooks, AI, S3).
- A batch's row renders all land in the trace of the request that queued it.
- Request duration ends when the response starts; streamed downloads aren't timed to the last byte.
- Metrics reset when a process restarts (Prometheus counters handle this).
- Logs go to stdout only; shipping them is the platform's job.

