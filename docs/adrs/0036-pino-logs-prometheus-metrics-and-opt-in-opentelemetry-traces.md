---
type: adr
title: pino logs, Prometheus metrics and opt-in OpenTelemetry traces
description: API and worker processes log one JSON object per line with pino, expose Prometheus metrics with @prometheus-io/client on a separate METRICS_PORT listener, and emit OpenTelemetry traces through the standard OTEL_* env only when an exporter is configured, with pg-boss carrying trace context from API to worker.
tags: [architecture, api, deployment, enterprise, observability]
status: stable
generated: { by: okq/0.9.0, at: 2026-10-12T05:59:49Z }
---

# pino logs, Prometheus metrics and opt-in OpenTelemetry traces

## Status

Accepted. Behaviour: [Observability](../features/observability.md). Builds on
[ADR 0020](0020-pg-boss-job-queue-and-separate-render-worker-processes.md)
(roles and the queue) and
[ADR 0025](0025-container-images-compose-and-helm-for-self-hosting.md)
(images, Compose, Helm).

## Context

Operators run necodoc next to their own Datadog, Grafana, Splunk or Elastic
stack. They need logs they can parse, metrics they can alert on and traces
that follow a render from the HTTP request into the worker. Until now the API
printed Hono's text request log and a few `console` lines, and the only
metrics were Admin > System, read from the generation log.

## Decision

- **Logs: pino**, one JSON object per line on stdout, with `LOG_LEVEL` and
  `LOG_FORMAT` (`json`, or `pretty` through pino-pretty; pretty is the
  default outside `NODE_ENV=production`). Every line inside a request carries
  its request id; request lines add the user or API key, status and duration;
  render lines add the timing breakdown. Secrets are dropped by pino's
  `redact`, which is also where field-value masking will plug in.
- **Metrics: `@prometheus-io/client`** (the Prometheus project's successor to
  `prom-client`, same API) on its own listener, `METRICS_PORT`, serving
  `/metrics`. Off when unset. A separate port keeps it out of the public
  `/api` proxy and ingress without a token to manage; network policy or the
  pod network is the access control. Every role serves it, since renders run
  on workers.
- **Traces: OpenTelemetry**, started through `@opentelemetry/sdk-node` only
  when `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or
  `OTEL_TRACES_EXPORTER` is set. Otherwise the SDK isn't loaded and every span
  call is skipped. The standard `OTEL_*` variables configure exporter,
  protocol, headers, sampler and resource. Spans are manual (HTTP request,
  render and its phases, storage write); there is no auto-instrumentation, so
  nothing has to load before the app.
- **Queue hops use pg-boss's own OpenTelemetry support**
  (`propagateContext`): it stores the trace context on each job and runs the
  worker's handler in a span continuing it. No trace fields of our own in job
  data.
- OTLP metrics and logs are off by default (`OTEL_METRICS_EXPORTER` and
  `OTEL_LOGS_EXPORTER` default to `none`); Prometheus and stdout are the
  supported paths.

## Consequences

- Logs ship with any collector that reads container stdout; no agent or
  sidecar is required.
- Queue gauges read pg-boss's queue table, which is cluster-wide: every
  process reports the same values, so dashboards take `max`, not `sum`.
- Without auto-instrumentation, Postgres queries and outbound HTTP (webhooks,
  AI, S3) have no spans of their own; they show as time inside their parent.
- A batch's row renders all join the trace of the request that queued them.
