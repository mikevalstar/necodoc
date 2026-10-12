import type { AppType } from "@necodoc/api/app";
import type {
  AssistantTools,
  DesignedDraft,
  previewTemplateSchema,
  RenderRequestInput,
} from "@necodoc/shared";
import { DefaultChatTransport, type UIDataTypes, type UIMessage } from "ai";
import { hc } from "hono/client";
import { z } from "zod";

/**
 * docs/features/public-demo.md (Nightly reset): when the API answers that the demo is resetting,
 * from when the app first heard. The root route swaps the page for the resetting screen.
 */
let resettingSince: number | null = null;
const resettingListeners = new Set<() => void>();
export const demoResetting = {
  since: () => resettingSince,
  subscribe(listener: () => void) {
    resettingListeners.add(listener);
    return () => resettingListeners.delete(listener);
  },
  start() {
    if (resettingSince !== null) return;
    resettingSince = Date.now();
    for (const listener of resettingListeners) listener();
  },
};

export const api = hc<AppType>("/", {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (res.status === 503 && res.headers.has("X-Demo-Resetting")) demoResetting.start();
    return res;
  },
}).api;

/** Handlers answer `{ error: "message" }`; the zod validator answers with a serialised ZodError. */
const errorBodySchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() })]),
});
const issuesSchema = z.array(z.object({ path: z.array(z.unknown()), message: z.string() }));

function errorMessage(body: unknown, status: number) {
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return `Request failed (${status})`;
  const { error } = parsed.data;
  if (typeof error === "string") return error;
  try {
    const issues = issuesSchema.parse(JSON.parse(error.message));
    return issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message)
      .join("; ");
  } catch {
    return error.message;
  }
}

type ApiResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** A failed API call: the API's message, plus the status for callers that branch on it (409). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Awaits a Hono client call and narrows it to its non-error responses. Failures throw an
 * ApiError with the API's message, so TanStack Query shows it.
 */
export async function ok<R extends ApiResponse>(
  request: R | Promise<R>,
): Promise<Exclude<R, { ok: false }>> {
  const res = await request;
  // Hono types `ok` as `false` on error statuses; TS can't narrow a generic on it by itself.
  if (res.ok) return res as Exclude<R, { ok: false }>;
  throw new ApiError(errorMessage(await res.json().catch(() => null), res.status), res.status);
}

/**
 * A finished render, or one still queued or running when the API stopped waiting (HTTP 202,
 * ADR 0020). A pending one shows up in the generation log; `waitForGeneration` polls it.
 */
export type RenderOutcome =
  | { pending: false; pdf: Blob; pageCount: number; generationId: string | null }
  | { pending: true; generationId: string };

/** POST /api/render. Logged renders may come back pending; previews never do. */
export async function renderPdf(request: RenderRequestInput): Promise<RenderOutcome> {
  const res = await ok(api.render.$post({ json: request }));
  if (res.status === 202) return { pending: true, generationId: (await res.json()).generationId };
  return {
    pending: false,
    pdf: await res.blob(),
    pageCount: Number(res.headers.get("X-Page-Count")),
    generationId: res.headers.get("X-Generation-Id"),
  };
}

/** A preview render (not logged, never queued), for live preview panes. */
export async function previewPdf(request: RenderRequestInput) {
  const outcome = await renderPdf({ ...request, preview: true });
  if (outcome.pending) throw new Error("The preview didn't finish");
  return outcome;
}

/** Polls a pending generation until it finishes, then fetches its PDF. Throws its error. */
export async function waitForGeneration(id: string, everyMs = 2000): Promise<RenderOutcome> {
  for (;;) {
    const row = await (await ok(api.generations[":id"].$get({ param: { id } }))).json();
    if (row.status === "success") {
      const res = await fetch(generationPdfUrl(id));
      if (!res.ok) throw new ApiError(`Couldn't load the PDF (${res.status})`, res.status);
      return {
        pending: false,
        pdf: await res.blob(),
        pageCount: row.pageCount ?? 0,
        generationId: id,
      };
    }
    if (row.status === "error" || row.status === "cancelled") {
      throw new Error(row.error ?? `The render was ${row.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/**
 * POST /api/templates/:id/preview: the saved draft, or the unsaved one the editor sends.
 * `dataValid` is false when the data doesn't fit the fields yet (it still renders).
 */
export async function previewTemplate({
  id,
  ...json
}: { id: string } & z.input<typeof previewTemplateSchema>) {
  const res = await ok(api.templates[":id"].preview.$post({ param: { id }, json }));
  return {
    pdf: await res.blob(),
    pageCount: Number(res.headers.get("X-Page-Count")),
    dataValid: res.headers.get("X-Data-Valid") === "true",
    warnings: renderWarnings(res.headers.get("X-Render-Warnings")),
  };
}

/** X-Render-Warnings: URI-encoded JSON list (overlay templates: text cut, unknown fields). */
function renderWarnings(header: string | null): string[] {
  if (!header) return [];
  try {
    return z
      .array(z.string())
      .catch([])
      .parse(JSON.parse(decodeURIComponent(header)));
  } catch {
    return [];
  }
}

/** Same-origin URLs the browser loads directly (img, iframe, download links, pdf.js). */
export const assetFileUrl = (id: string) => `/api/assets/${id}/file`;
export const pdfSourceUrl = (id: string) => `/api/pdf-sources/${id}/pdf`;
export const generationPdfUrl = (id: string) => `/api/generations/${id}/pdf`;
export const submissionPdfUrl = (id: string) => `/api/submissions/${id}/pdf`;
/** `version` is the list's `thumbnail`, so a new publish or save fetches a new image. */
export const templateThumbnailUrl = (id: string, version: string) =>
  `/api/templates/${id}/thumbnail?v=${encodeURIComponent(version)}`;

/** A chat message with the template assistant's typed proposals (ADR 0035). */
export type AssistantMessage = UIMessage<unknown, UIDataTypes, AssistantTools>;

/**
 * useChat's transport to POST /api/templates/:id/assistant (a UI message stream, not Hono RPC).
 * Every turn sends the editor's current draft; `draft` throws when it isn't valid yet.
 */
export const assistantTransport = (id: string, draft: () => DesignedDraft) =>
  new DefaultChatTransport<AssistantMessage>({
    api: `/api/templates/${id}/assistant`,
    // The SDK shows a failed response's body as the error: hand it the message, not the JSON
    // (the public demo's AI cap answers 429 with one, ADR 0046).
    fetch: async (input, init) => {
      const res = await fetch(input, init);
      if (res.ok) return res;
      const message = errorMessage(await res.json().catch(() => null), res.status);
      return new Response(message, { status: res.status });
    },
    prepareSendMessagesRequest: ({ messages }) => ({ body: { messages, draft: draft() } }),
  });
