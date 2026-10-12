import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import { trace } from "@opentelemetry/api";
import pino, { type DestinationStream, type LevelWithSilent } from "pino";

// ADR 0036: one JSON object per line. Kept free of env and the database so tests can build one.

/**
 * Replaced with "[Redacted]" wherever they appear (top level or one object down). Field values are
 * never logged (ADR 0039); `data`, `input` and `fields` are a backstop for anything that tries.
 */
export const redactPaths = [
  "data",
  "*.data",
  "input",
  "*.input",
  "fields",
  "*.fields",
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

/** An error message or stack without the query parameters a failed database call carries. */
export const withoutQueryParams = (text: string) =>
  text.replace(queryParams, "\nparams: [Redacted]");

/** pino's error serializer, without the query parameters a failed database call carries. */
export function serializeError(error: Error) {
  const { params: _params, ...serialized } = pino.stdSerializers.err(error);
  return {
    ...serialized,
    message: withoutQueryParams(serialized.message),
    stack: withoutQueryParams(serialized.stack),
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
