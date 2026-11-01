import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

// ADR 0036: OpenTelemetry traces, opt-in through the standard OTEL_* env. With none of these set
// the SDK is never imported and `withSpan` runs its function bare. No env.ts or database here: the
// renderer imports this.

const { env } = process;

/** Whether this process exports traces. Read at import, before anything starts. */
export const tracingEnabled =
  env.OTEL_SDK_DISABLED !== "true" &&
  Boolean(
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      (env.OTEL_TRACES_EXPORTER && env.OTEL_TRACES_EXPORTER !== "none"),
  );

export const tracer = trace.getTracer("necodoc");

let stop: (() => Promise<void>) | undefined;

/** Starts the SDK when tracing is configured. `service` names it unless OTEL_SERVICE_NAME does. */
export async function startTracing(resource: {
  service: string;
  version: string;
  instance: string;
}) {
  if (!tracingEnabled) return;
  // Traces only: metrics go to Prometheus and logs to stdout unless the operator asks otherwise.
  env.OTEL_METRICS_EXPORTER ??= "none";
  env.OTEL_LOGS_EXPORTER ??= "none";
  const [{ NodeSDK }, { defaultResource, resourceFromAttributes }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/resources"),
  ]);
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ? undefined : resource.service,
    // OTEL_RESOURCE_ATTRIBUTES still wins over these.
    resource: defaultResource().merge(
      resourceFromAttributes({
        "service.version": resource.version,
        "service.instance.id": resource.instance,
      }),
    ),
  });
  sdk.start();
  stop = () => sdk.shutdown();
}

/** Flushes spans still buffered. */
export const stopTracing = async () => stop?.();

/**
 * Runs `fn` in a child span of the active one; marks it failed if `fn` throws. `fn` gets the span
 * to add attributes to (or undefined when tracing is off). `scrub` cleans a failure's message
 * before it goes on the span (render errors can quote field values, ADR 0039).
 */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span | undefined) => Promise<T>,
  scrub?: (message: string) => string,
): Promise<T> {
  if (!tracingEnabled) return fn(undefined);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      failSpan(span, error, scrub);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function failSpan(span: Span, error: unknown, scrub = (message: string) => message) {
  const message = scrub(error instanceof Error ? error.message : String(error));
  if (error instanceof Error) {
    span.recordException({ name: error.name, message, stack: error.stack && scrub(error.stack) });
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}
