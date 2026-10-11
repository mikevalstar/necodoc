// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightOpenAPI, { openAPISidebarGroups } from "starlight-openapi";

// ADR 0026 (docs/adrs/0026-astro-starlight-for-the-developer-docs-site.md). The API reference is
// generated from the /api/v1 OpenAPI document (ADR 0030), which scripts/generate.ts writes
// before every build.
export default defineConfig({
  integrations: [
    starlight({
      title: "necodoc docs",
      logo: { src: "./src/assets/neko-mark.svg" },
      favicon: "/favicon.svg",
      plugins: [
        starlightOpenAPI([
          {
            base: "reference/api",
            schema: "./src/generated/openapi.json",
            sidebar: { label: "API reference", collapsed: false, operations: { badges: true } },
          },
        ]),
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
