import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

// ADR 0030: the client is openapi-fetch typed by schema.ts, which `pnpm generate` writes from the
// /api/v1 OpenAPI document. Nothing here is written by hand beyond auth and the base URL.

export type { components, operations, paths } from "./schema";

/** A schema from the API reference, by name: `Schema<"RenderRequest">`. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type NecodocClientOptions = {
  /** Your deployment's origin, e.g. `https://necodoc.example.com`. */
  baseUrl: string;
  /** A key from Settings › API keys or Admin › Service accounts (starts with `nd_`). */
  apiKey: string;
  /** Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
};

/** A typed client for `/api/v1`, sending the key in `x-api-key` on every call. */
export function createNecodocClient({ baseUrl, apiKey, fetch }: NecodocClientOptions) {
  return createClient<paths>({
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/api/v1`,
    headers: { "x-api-key": apiKey },
    ...(fetch ? { fetch } : {}),
  });
}

export type NecodocClient = ReturnType<typeof createNecodocClient>;
