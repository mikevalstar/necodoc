# @necodoc/sdk

A typed TypeScript client for the necodoc public API (`/api/v1`). Types are generated from the
API's OpenAPI document; requests go through [openapi-fetch](https://openapi-ts.dev/openapi-fetch/).

## Install

The package lives in the necodoc repository (`packages/sdk-ts`) and isn't published to npm yet.
Inside the workspace, depend on `@necodoc/sdk`; elsewhere, copy the package or install it from a
git checkout.

## Create a client

```ts
import { createNecodocClient } from "@necodoc/sdk";

const necodoc = createNecodocClient({
  baseUrl: "https://necodoc.example.com",
  apiKey: process.env.NECODOC_API_KEY!, // nd_…
});
```

Every call returns `{ data, error, response }`. `error` is the API's error body
(`{ error, code, fieldErrors? }`) when the status isn't 2xx.

## Render HTML to a PDF

```ts
const { data: pdf, error } = await necodoc.POST("/render", {
  body: {
    html: "<h1>Invoice {{ number }}</h1>",
    data: { number: "A-1001" },
    footer: { html: "<p>{{ page }} / {{ pages }}</p>", height: 12 },
  },
  parseAs: "arrayBuffer",
});
if (error) throw new Error(`${error.code}: ${error.error}`);
await writeFile("invoice.pdf", new Uint8Array(pdf));
```

## Generate from a template, as JSON

```ts
const { data } = await necodoc.POST("/templates/{id}/versions/{version}/generate", {
  params: { path: { id: templateId, version: "latest" } },
  body: { data: { client_name: "Acme" }, response: "json" },
});
// data.generationId, data.downloadUrl (signed, 1 hour), data.pdfPath
```

Invalid data answers 422 with `error.fieldErrors`, one entry per field.

## Async renders and polling

```ts
const { data: queued } = await necodoc.POST("/render", {
  body: { html: "<p>Big report</p>", async: true },
});
if (!queued || typeof queued === "string") throw new Error("Expected a generation id");
let status = queued.status;
while (status === "queued" || status === "running") {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const { data } = await necodoc.GET("/generations/{id}", {
    params: { path: { id: queued.generationId } },
  });
  status = data?.status ?? "error";
}
```

A render still running when the server stops waiting also answers `202` with a generation id, so
handle `response.status === 202` on synchronous calls too. Webhooks avoid polling altogether.

## Types

`paths`, `components` and `operations` are re-exported. `Schema<"RenderRequest">` picks one
schema by name.

## Regenerating

`pnpm --filter @necodoc/sdk generate` writes `openapi.json` from the API code and regenerates
`src/schema.ts`. It runs openapi-typescript through `pnpm dlx` with TypeScript 6, because
openapi-typescript needs the TypeScript compiler API, which TypeScript 7 doesn't ship. Fields
with a server-side default (`response`, `async`, `page`) stay optional
(`--default-non-nullable false`).
