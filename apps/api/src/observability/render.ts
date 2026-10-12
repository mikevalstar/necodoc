import { type RenderInput, type RenderTimings, scrubValues } from "@necodoc/shared";
import { log } from "../log";
import { queueWait, renderDuration, renderPhaseDuration } from "./metrics";
import { withSpan } from "./tracing";

// ADR 0036: what generate.ts reports about each render, kept out of its control flow.

const modeOf = (request: RenderInput) => ("kind" in request ? request.kind : "html");

/** Text with the request's field values and signers masked: logs and spans never carry them. */
const scrubRequest = (text: string, request: RenderInput | null) =>
  request && "data" in request ? scrubValues(text, [request.data, request.signers]) : text;

/** Runs one render in a span and times it into `necodoc_render_duration_seconds`. */
export async function observeRender<T extends { timings: RenderTimings; pageCount: number }>(
  kind: "generation" | "preview",
  request: RenderInput,
  render: (request: RenderInput) => Promise<T>,
): Promise<T> {
  const mode = modeOf(request);
  const started = performance.now();
  let status = "error";
  try {
    const result = await withSpan(
      `render ${mode}`,
      { "necodoc.render.mode": mode, "necodoc.render.kind": kind },
      async (span) => {
        const rendered = await render(request);
        span?.setAttributes({
          "necodoc.render.pages": rendered.pageCount,
          ...Object.fromEntries(
            Object.entries(rendered.timings).map(([key, ms]) => [`necodoc.render.${key}`, ms]),
          ),
        });
        return rendered;
      },
      (message) => scrubRequest(message, request),
    );
    status = "success";
    if (kind === "generation") {
      for (const [key, ms] of Object.entries(result.timings)) {
        renderPhaseDuration.observe({ mode, phase: key.replace(/Ms$/, "") }, ms / 1000);
      }
    }
    return result;
  } finally {
    const seconds = (performance.now() - started) / 1000;
    renderDuration.observe({ mode, kind, status }, seconds);
    // Live previews run on every edit; logged renders get their own line from logGeneration.
    if (kind === "preview")
      log.debug({ mode, status, durationMs: Math.round(seconds * 1000) }, "preview");
  }
}

/** The one log line per finished attempt of a logged render (docs/features/observability.md). */
export function logGeneration(entry: {
  generationId: string;
  request: RenderInput | null;
  attempt: number;
  workerId: string;
  queueWaitMs: number;
  durationMs: number;
  totalMs: number;
  outcome:
    | { pageCount: number; timings: RenderTimings; warnings: string[]; output: { size: number } }
    | { error: string };
}) {
  const { outcome, request, ...rest } = entry;
  queueWait.observe(entry.queueWaitMs / 1000);
  const line = { ...rest, mode: request ? modeOf(request) : undefined };
  if ("error" in outcome) {
    log.warn(
      { ...line, status: "error", error: scrubRequest(outcome.error, request) },
      "render failed",
    );
    return;
  }
  log.info(
    {
      ...line,
      status: "success",
      pageCount: outcome.pageCount,
      size: outcome.output.size,
      warnings: outcome.warnings.length,
      timings: outcome.timings,
    },
    `render done in ${entry.durationMs}ms`,
  );
}
