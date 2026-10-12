---
title: Observability
description: JSON logs, Prometheus metrics and OpenTelemetry traces for a necodoc install, with suggested alerts.
sidebar:
  order: 11
---

Every API and worker process writes JSON logs to stdout, can serve Prometheus metrics on a port of its own, and, when you point it at an OpenTelemetry collector, traces each render from the HTTP request through the queue into the worker. All three work with Datadog, Grafana (Loki, Prometheus/Mimir, Tempo), Splunk, Elastic, New Relic and anything else that reads container stdout, scrapes Prometheus or accepts OTLP.

Inside the app you also have **Admin > System** (workers, queue depth, render percentiles), the [generation log](/guides/generation-log/) (every render's status, error and timing breakdown) and the [health endpoints](/self-hosting/health-checks/).

## Logs

| Variable | Default | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `LOG_FORMAT` | `json` in the image | `json`: one object per line. `pretty`: coloured lines for a terminal (the default when `NODE_ENV` isn't `production`). |

Every line has `level` (a name, not a number), `time` (ISO 8601), `msg`, `pid`, `hostname` and `role`. What gets logged:

- **Each request** (`info`; `error` for 5xx; health checks at `debug`): `requestId`, `method`, `path`, `route` (the pattern, e.g. `/api/templates/:id`), `status`, `durationMs`, `userId` or `apiKeyId`, `ip`. Share-link and signed-download tokens are logged as the route pattern, not the token.
- **Anything logged during a request** carries its `requestId`, the same value as the `X-Request-Id` response header (send your own `X-Request-Id` and it's kept). With tracing on, lines also carry `trace_id` and `span_id`.
- **Each finished render attempt** (`info`, or `warn` when it failed): `generationId`, `mode` (`html`, `overlay`, `combine`), `status`, `attempt`, `workerId`, `pageCount`, `size`, `queueWaitMs`, `durationMs`, `totalMs`, and `timings` (`liquidMs`, `chromiumMs`, `bandsMs`, `stampMs`, `finishMs`), or `error`. Previews log at `debug`.
- **Each queue job**: lines carry `queue`, `jobId` and `generationId`; failures log at `warn` with the error before pg-boss retries them.
- **Errors** are logged as `err` with `type`, `message` and `stack`. Database errors keep the query but not its parameters.

Passwords, tokens, secrets, cookies and authorization headers are replaced with `[Redacted]`. Field values aren't logged.

Example request line:

```json
{"level":"info","time":"2026-10-12T06:07:03.442Z","pid":7,"hostname":"necodoc-api-6c9f","role":"api","requestId":"verify-obs-2","method":"POST","path":"/api/v1/render","route":"/api/v1/render","status":200,"durationMs":812,"apiKeyId":"k_3f1…","ip":"10.0.4.17","msg":"POST /api/v1/render 200 812ms"}
```

**Shipping them.** Collect container stdout as you do for everything else: the Datadog agent, Grafana Alloy or Promtail, Splunk Connect for Kubernetes, Fluent Bit or Filebeat. Each line is a complete JSON object, so no multiline or grok rules are needed. Map `level` to severity and `msg` to the message; in Datadog, `trace_id` links logs to APM traces when you send traces there too.

## Metrics

Set `METRICS_PORT` (e.g. `9464`) and every process, API and worker, serves Prometheus text on `http://<pod>:<port>/metrics`. It's a separate listener on purpose: the app's `/api` proxy and your ingress never forward it. **It has no authentication.** Don't publish the port; let only Prometheus (or your agent) reach it, e.g. with a Kubernetes NetworkPolicy.

| Metric | Type | Labels | What it measures |
| --- | --- | --- | --- |
| `necodoc_http_request_duration_seconds` | histogram | `method`, `route`, `status` | API requests until the response started. `_count` is the request rate. |
| `necodoc_render_duration_seconds` | histogram | `mode`, `kind` (`generation`, `preview`), `status` | Rendering itself: Liquid, Chromium, bands, pdf-lib. |
| `necodoc_render_phase_seconds` | histogram | `mode`, `phase` (`liquid`, `chromium`, `bands`, `stamp`, `finish`) | Where logged renders spent their time. `finish` is PDF/A, PDF/UA and certification. |
| `necodoc_render_queue_wait_seconds` | histogram | | Queued to the start of the last attempt. |
| `necodoc_job_duration_seconds` | histogram | `queue`, `status` (`completed`, `failed`) | Every queue job a worker ran: `render`, `webhook`, `detect-fields`, `retention`, `render-lost`. |
| `necodoc_queue_jobs` | gauge | `queue`, `state` (`ready`, `deferred`, `active`, `failed`) | Jobs per pg-boss queue, cluster-wide. |
| `necodoc_queue_oldest_ready_seconds` | gauge | `queue` | Age of the oldest job waiting to start. |
| `necodoc_queue_paused` | gauge | `queue` | 1 while an admin has the queue paused, else 0. |
| `necodoc_worker_renders_running` | gauge | | Render jobs this process is running. |
| `necodoc_worker_render_slots` | gauge | | This process's `RENDER_CONCURRENCY` (0 for `ROLE=api`). |
| `necodoc_build_info` | gauge | `version`, `role` | Always 1. |
| `process_*`, `nodejs_*` | | | CPU, memory, heap, event-loop lag, GC, handles. |

Queue gauges come from pg-boss's queue table, refreshed every 10 seconds, so every process reports the same numbers: aggregate them with `max`, not `sum`. Counters reset when a process restarts; `rate()` and `increase()` handle that.

### Suggested alerts

```yaml
groups:
  - name: necodoc
    rules:
      - alert: NecodocNoWorkers
        expr: sum(necodoc_worker_render_slots) == 0
        for: 2m
      - alert: NecodocRenderBacklog
        expr: max(necodoc_queue_oldest_ready_seconds{queue="render"}) > 60
        for: 5m
      - alert: NecodocRenderErrors
        expr: |
          sum(rate(necodoc_render_duration_seconds_count{kind="generation",status="error"}[10m]))
            / sum(rate(necodoc_render_duration_seconds_count{kind="generation"}[10m])) > 0.05
        for: 10m
      - alert: NecodocSlowRenders
        expr: |
          histogram_quantile(0.95, sum by (le) (rate(necodoc_render_duration_seconds_bucket{kind="generation"}[10m]))) > 10
        for: 15m
      - alert: NecodocApiErrors
        expr: sum(rate(necodoc_http_request_duration_seconds_count{status=~"5.."}[5m])) > 0.1
        for: 5m
      - alert: NecodocWebhooksFailing
        expr: max(necodoc_queue_jobs{queue="webhook",state="failed"}) > 0
        for: 30m
```

Worker saturation for capacity planning or autoscaling: `sum(necodoc_worker_renders_running) / sum(necodoc_worker_render_slots)`.

**Datadog** reads these with its OpenMetrics check (`openmetrics_endpoint: http://%%host%%:9464/metrics`, `namespace: necodoc`, `metrics: [".*"]`) or the pod annotations below. **Grafana Cloud** and **New Relic** scrape them with Grafana Alloy or their Prometheus agent.

## Traces

Tracing is off until you configure an exporter with the standard OpenTelemetry variables. Then the SDK starts; otherwise it isn't loaded at all.

| Variable | Example | |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | Turns tracing on. Collector, Jaeger, Tempo, Datadog agent (OTLP on), Honeycomb, etc. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default), `http/json`, `grpc` | Use `grpc` with port 4317. |
| `OTEL_EXPORTER_OTLP_HEADERS` | `x-honeycomb-team=…` | Auth for hosted backends. Put it in the Secret. |
| `OTEL_TRACES_EXPORTER` | `console` | Prints spans to stdout instead; handy for a first check. |
| `OTEL_SERVICE_NAME` | | Defaults to `necodoc-api`, `necodoc-worker` or `necodoc` (`ROLE=all`). |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio`, `0.1` | Sample 10% of traces. Default: every trace. |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=prod` | Extra resource attributes. |

One render is one trace:

- `POST /api/v1/render` (server span; continues an incoming W3C `traceparent`)
  - Better Auth spans for session and key checks
  - `insert render` (pg-boss, producer): the job is queued with the trace context
  - `process render` (pg-boss, consumer, on the worker)
    - `render html` (or `render overlay`, `render combine`) with page count and timings
      - `render.liquid`, `render.chromium`, `render.bands`, `render.stamp`
    - `storage.write`

OTLP metrics and logs are off (`OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` default to `none`); use Prometheus and stdout for those.

## Docker Compose

The `monitoring` profile adds Prometheus (scraping the API and every worker) and Jaeger:

```sh
# in .env
METRICS_PORT=9464
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318

docker compose --profile monitoring up -d
```

Prometheus is on `http://localhost:9090`, Jaeger on `http://localhost:16686`. They're for trying it out; in production point the variables at your own stack.

## Helm

```yaml
metrics:
  enabled: true # sets METRICS_PORT, adds the port and prometheus.io/* pod annotations
  port: 9464
  podMonitor:
    enabled: true # with the Prometheus Operator; scrapes api and worker pods
    interval: 30s
    labels: { release: kube-prometheus-stack }
config:
  LOG_LEVEL: info
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.observability:4318
```

The chart uses a `PodMonitor` rather than a `ServiceMonitor` because workers have no Service. With `metrics.enabled` and no operator, the `prometheus.io/scrape`, `prometheus.io/port` and `prometheus.io/path` annotations work with annotation-based scrape configs (and Datadog's autodiscovery).

## Limitations

- The metrics port has no authentication; keep it off public networks.
- No spans for individual Postgres queries (except Better Auth's) or outbound HTTP calls (webhooks, AI, S3); their time shows inside the parent span.
- All rows of a batch join the trace of the request that queued them.
- Request durations end when the response starts; long downloads aren't timed to the last byte.
