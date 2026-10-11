import type { AppType } from "@necodoc/api/app";
import type { RenderRequestInput } from "@necodoc/shared";
import { hc } from "hono/client";
import { z } from "zod";

export const api = hc<AppType>("/").api;

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

/**
 * Awaits a Hono client call and narrows it to its non-error responses. Failures throw the API's
 * message, so TanStack Query shows it.
 */
export async function ok<R extends ApiResponse>(
  request: Promise<R>,
): Promise<Exclude<R, { ok: false }>> {
  const res = await request;
  // Hono types `ok` as `false` on error statuses; TS can't narrow a generic on it by itself.
  if (res.ok) return res as Exclude<R, { ok: false }>;
  throw new Error(errorMessage(await res.json().catch(() => null), res.status));
}

/** POST /api/render. Previews (`preview: true`) come back without a generation id. */
export async function renderPdf(request: RenderRequestInput) {
  const res = await ok(api.render.$post({ json: request }));
  return {
    pdf: await res.blob(),
    pageCount: Number(res.headers.get("X-Page-Count")),
    generationId: res.headers.get("X-Generation-Id"),
  };
}

/** Same-origin URLs the browser loads directly (img, iframe, download links). */
export const assetFileUrl = (id: string) => `/api/assets/${id}/file`;
export const generationPdfUrl = (id: string) => `/api/generations/${id}/pdf`;
