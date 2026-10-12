import { describe, expect, it } from "vitest";
import { httpDuration, registry, renderDuration, serveMetrics } from "./metrics";

describe("metrics", () => {
  it("exposes our histograms with their labels, and Node's process metrics", async () => {
    httpDuration.observe({ method: "GET", route: "/api/templates/:id", status: 200 }, 0.02);
    renderDuration.observe({ mode: "html", kind: "generation", status: "success" }, 1.2);
    const text = await registry.metrics();
    expect(text).toContain(
      'necodoc_http_request_duration_seconds_count{method="GET",route="/api/templates/:id",status="200"} 1',
    );
    expect(text).toContain(
      'necodoc_render_duration_seconds_bucket{le="2.5",mode="html",kind="generation",status="success"} 1',
    );
    expect(text).toContain("process_cpu_user_seconds_total");
    expect(text).toContain("nodejs_eventloop_lag_seconds");
  });

  it("serves /metrics and nothing else on its own port", async () => {
    const server = serveMetrics(0, () => {});
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Not listening on a port");
    const { port } = address;
    try {
      const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      expect(await metrics.text()).toContain("necodoc_http_request_duration_seconds");
      expect((await fetch(`http://127.0.0.1:${port}/api/me`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
