---
title: Observability
description: Logs, metrics and alerting for a necodoc install.
sidebar:
  order: 11
  badge: { text: Coming, variant: note }
---

:::note[Coming]
A metrics endpoint for Prometheus and tracing are planned. This page will cover them, with suggested alerts.
:::

What exists today:

- **Logs**: every process logs to stdout. API requests are logged with method, path, status and time, and every response carries an `X-Request-Id`.
- **Admin > System**: workers online, queue depth by priority, renders per minute, p50/p95/p99 render time and error rate, over selectable windows.
- **Generation log**: every logged render with its status, error and timing breakdown (queue wait, Liquid, Chromium, bands, stamping). See [Generation log](/guides/generation-log/).
- **Health**: [`/api/health/ready`](/self-hosting/health-checks/) reports database, queue, storage and workers online.
