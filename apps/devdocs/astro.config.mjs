// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// ADR 0026 (docs/adrs/0026-astro-starlight-for-the-developer-docs-site.md). The API reference
// will be generated from the /api/v1 OpenAPI spec with starlight-openapi; see scripts/generate.ts.
export default defineConfig({
  integrations: [
    starlight({
      title: "necodoc docs",
      logo: { src: "./src/assets/neko-mark.svg" },
      favicon: "/favicon.svg",
      sidebar: [
        { label: "Getting started", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Self-hosting", items: [{ autogenerate: { directory: "self-hosting" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
    }),
  ],
});
