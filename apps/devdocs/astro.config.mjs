// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

// ADR 0026 (docs/adrs/0026-astro-starlight-for-the-developer-docs-site.md). The API reference is
// generated from the /api/v1 OpenAPI document (ADR 0030), which scripts/generate.ts writes
// before every build.
const site = process.env.DEVDOCS_SITE || undefined;

export default defineConfig({
  // The public URL, when the docs are hosted (self-hosting/developer-docs.md): enables the sitemap
  // and canonical links. Unset for local builds.
  site,
  integrations: [
    starlight({
      title: "necodoc docs",
      logo: { src: "./src/assets/neko-mark.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "external", label: "necodoc.com", href: "https://necodoc.com" }],
      // Social cards need an absolute image URL, so only with the public URL.
      head: site
        ? [{ tag: "meta", attrs: { property: "og:image", content: new URL("/og.png", site).href } }]
        : [],
      // API reference titles and descriptions (src/route-data.ts).
      routeMiddleware: "./src/route-data.ts",
      plugins: [
        starlightOpenAPI([
          {
            base: "reference/api",
            schema: "./src/generated/openapi.json",
            sidebar: { label: "API reference", collapsed: false, operations: { badges: true } },
          },
        ]),
        // llms.txt, llms-full.txt and llms-small.txt for AI coding tools. Its links are absolute, so
        // it needs the public URL.
        ...(site
          ? [
              starlightLlmsTxt({
                projectName: "necodoc",
                description:
                  "Self-hosted document generation: fill existing PDF forms or render designed HTML templates to PDF through a versioned REST API (/api/v1), with batches, webhooks, signing packages and PDF/A output. MIT licensed.",
                details: [
                  "- Run it: [Quick start](/getting-started/quickstart/) (Docker Compose), [Configuration](/self-hosting/configuration/), [Kubernetes](/self-hosting/kubernetes-helm/).",
                  "- Call it: send the `x-api-key` header to `/api/v1` ([API keys](/guides/api-keys/)). Every deployment serves its OpenAPI 3.1 document at `/api/v1/openapi.json`; see the [API reference](/reference/api/) and [SDKs](/reference/sdks/) (TypeScript, Python, .NET, Java).",
                  "- Make PDFs: [HTML to PDF](/guides/html-to-pdf/), [Templates and Liquid](/guides/templates-and-liquid/), [Headers and footers](/guides/headers-footers/), [Batches and async](/guides/batches-and-async/), [Webhooks](/guides/webhooks/).",
                  "- Concepts: [Concepts](/getting-started/concepts/).",
                ]
                  .join("\n")
                  .replaceAll("](/", `](${site}/`),
              }),
            ]
          : []),
      ],
      sidebar: [
        { label: "Getting started", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Self-hosting", items: [{ autogenerate: { directory: "self-hosting" } }] },
        {
          label: "Reference",
          items: [...openAPISidebarGroups, { autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});
