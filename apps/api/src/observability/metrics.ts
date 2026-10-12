import { createServer } from "node:http";
import { collectDefaultMetrics, Gauge, Histogram, Registry } from "@prometheus-io/client";

// ADR 0036: Prometheus metrics, served on METRICS_PORT by `serveMetrics`. Free of env and the
// database; queue.ts and worker.ts register the gauges that read them.

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

/** Seconds, from a few milliseconds up to a synchronous render's 30 s wait and past it. */
const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export const buildInfo = new Gauge({
  name: "necodoc_build_info",
  help: "Always 1; labels carry the version and role.",
  labelNames: ["version", "role"] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: "necodoc_http_request_duration_seconds",
  help: "API requests until the response started, by method, route pattern and status.",
  labelNames: ["method", "route", "status"] as const,
  buckets,
  registers: [registry],
});

export const renderDuration = new Histogram({
  name: "necodoc_render_duration_seconds",
  help: "Renders (Liquid, Chromium, pdf-lib), by mode, kind (generation or preview) and status.",
  labelNames: ["mode", "kind", "status"] as const,
  buckets,
  registers: [registry],
});

export const renderPhaseDuration = new Histogram({
  name: "necodoc_render_phase_seconds",
  help: "Time logged renders spent in each phase: liquid, chromium, bands, stamp.",
  labelNames: ["mode", "phase"] as const,
  buckets,
  registers: [registry],
});

export const queueWait = new Histogram({
  name: "necodoc_render_queue_wait_seconds",
  help: "Logged renders' wait from queued to their last attempt's start.",
  buckets: [...buckets, 300, 900, 3600],
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: "necodoc_job_duration_seconds",
  help: "Queue jobs this worker ran, by queue and status (completed or failed).",
  labelNames: ["queue", "status"] as const,
  buckets,
  registers: [registry],
});

/** Serves `/metrics` (and nothing else) on its own port. */
export function serveMetrics(port: number, onListening: () => void) {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await registry.metrics();
      res.writeHead(200, { "Content-Type": registry.contentType }).end(body);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  server.listen(port, onListening);
  return server;
}
