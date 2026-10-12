import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { log } from "../log";
import { type AppEnv, clientIp } from "../middleware";
import { logContext, withoutQueryParams } from "./logger";
import { httpDuration } from "./metrics";
import { failSpan, tracer, tracingEnabled } from "./tracing";

// ADR 0036: one log line, one histogram sample and (with tracing) one server span per request.

/** The /api/v1 key guard (api-keys.ts) sets this on the request's context. */
type KeyEnv = AppEnv & { Variables: { apiKey?: { id: string } } };

export const observeRequests = createMiddleware<KeyEnv>(async (c, next) => {
  const started = performance.now();
  const requestId = c.get("requestId");
  const run = () => logContext.run({ requestId }, next);
  // Continues a caller's W3C traceparent.
  const parent = tracingEnabled ? propagation.extract(ROOT_CONTEXT, c.req.header()) : undefined;
  const span = parent
    ? tracer.startSpan(
        c.req.method,
        {
          kind: SpanKind.SERVER,
          attributes: {
            "http.request.method": c.req.method,
            "url.path": c.req.path,
            "necodoc.request_id": requestId,
          },
        },
        parent,
      )
    : undefined;
  if (parent && span) await context.with(trace.setSpan(parent, span), run);
  else await run();

  const status = c.res.status;
  const durationMs = Math.round(performance.now() - started);
  // The matched route's pattern (bounded, unlike paths); share and signed-link tokens stay out.
  // After the chain, the index is the last handler that ran: the route, or its guard.
  const route = routePath(c) || "unmatched";
  const path = route.includes(":token") ? route : c.req.path;
  const userId = c.get("user")?.id;
  const apiKeyId = c.get("apiKey")?.id;
  httpDuration.observe({ method: c.req.method, route, status }, durationMs / 1000);
  if (span) {
    span.updateName(`${c.req.method} ${route}`);
    span.setAttributes({ "http.route": route, "http.response.status_code": status });
    if (userId) span.setAttribute("necodoc.user_id", userId);
    if (apiKeyId) span.setAttribute("necodoc.api_key_id", apiKeyId);
    if (c.error) failSpan(span, c.error, withoutQueryParams);
    else if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  }
  const line = {
    requestId,
    method: c.req.method,
    path,
    route,
    status,
    durationMs,
    userId,
    apiKeyId,
    ip: clientIp(c),
    err: c.error,
    ...(span && { trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId }),
  };
  const message = `${c.req.method} ${path} ${status} ${durationMs}ms`;
  if (status >= 500) log.error(line, message);
  else if (route.startsWith("/api/health")) log.debug(line, message);
  else log.info(line, message);
});
