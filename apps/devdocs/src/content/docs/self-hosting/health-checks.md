---
title: Health checks
description: Liveness and readiness endpoints for load balancers and orchestrators.
sidebar:
  order: 7
---

Both endpoints are unauthenticated and answered by every role, including workers (which serve nothing else).

## Liveness: `GET /api/health`

The process is up.

```json
{ "ok": true, "role": "api" }
```

The `necodoc-api` image's Docker `HEALTHCHECK` calls this, as do the chart's startup and liveness probes.

## Readiness: `GET /api/health/ready`

`200` when the node can do its job, `503` otherwise.

```json
{
  "ready": true,
  "role": "api",
  "database": true,
  "queue": true,
  "storage": { "driver": "s3", "ok": true },
  "workersOnline": 2
}
```

- `database`: `select 1` succeeds.
- `queue`: pg-boss has started on this node.
- `storage`: the output storage round-trips (see [Storage](/self-hosting/storage/)). On failure it carries an `error` message. The check times out after 5 seconds, so a hung mount fails the probe instead of hanging it.
- `workersOnline`: workers with a recent heartbeat. Informational only: an API node with no workers is still ready (it can accept async work), but nothing renders. Alert on `0`.

Point load balancers and Kubernetes readiness probes at this endpoint. Use a timeout above 5 seconds.

Behind the app container both endpoints are at the same paths, e.g. `https://necodoc.example.com/api/health/ready`.
