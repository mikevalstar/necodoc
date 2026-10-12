import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import { trace } from "@opentelemetry/api";
import pino, { type DestinationStream, type LevelWithSilent } from "pino";

// ADR 0036: one JSON object per line. Kept free of env and the database so tests can build one.

/**
 * Replaced with "[Redacted]" wherever they appear (top level or one object down). The PII-masking
 * phase adds field-value paths here; anything logging field values must put them under `fields`
 * so one path (`fields.*`) can cover them.
 */
export const redactPaths = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  'headers["set-cookie"]',
];

/** Drizzle's "params: …" (rendered input, field values) up to the stack trace or the end. */
const queryParams = /\nparams: [\s\S]*?(?=\n {4}at |$)/g;

/** pino's error serializer, without the query parameters a failed database call carries. */
export function serializeError(error: Error) {
  const { params: _params, ...serialized } = pino.stdSerializers.err(error);
  return {
    ...serialized,
    message: serialized.message.replace(queryParams, "\nparams: [Redacted]"),
    stack: serialized.stack.replace(queryParams, "\nparams: [Redacted]"),
  };
}

/** Bindings every line written inside it carries: a request's id, a job's queue and id. */
export const logContext = new AsyncLocalStorage<Record<string, string | number | undefined>>();

/** The active span's ids, so a log line links to its trace. Nothing when tracing is off. */
function traceIds() {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

export function createLogger(
  options: { level: LevelWithSilent; base?: Record<string, unknown> },
  destination?: DestinationStream,
) {
  return pino(
    {
      level: options.level,
      base: { pid: process.pid, hostname: hostname(), ...options.base },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Level names, not numbers: what Datadog, Splunk and Elastic expect.
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: redactPaths },
      serializers: { err: serializeError },
      mixin: () => ({ ...logContext.getStore(), ...traceIds() }),
    },
    // Synchronous stdout, so nothing is lost when the process exits.
    destination ?? pino.destination(1),
  );
}

export type Logger = ReturnType<typeof createLogger>;
