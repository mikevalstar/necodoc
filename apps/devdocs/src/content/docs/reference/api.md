---
title: API reference
description: The public /api/v1 reference, generated from its OpenAPI document. Coming.
sidebar:
  order: 1
  badge: { text: Coming, variant: note }
---

:::note[Coming]
The public API (`/api/v1`, authenticated with per-user API keys) doesn't exist yet.
:::

When it ships, this section will be generated from its OpenAPI document at build time with [starlight-openapi](https://github.com/HiDeoo/starlight-openapi), so the reference always matches the code. The build hook is `apps/devdocs/scripts/generate.ts`, which runs before `astro build`.

Until then, the guides document the app's internal, session-authenticated API:

- [HTML to PDF](/guides/html-to-pdf/): `POST /api/render`
- [Templates and Liquid](/guides/templates-and-liquid/#generating-from-a-template): generating from a template
- [Batches and async renders](/guides/batches-and-async/)
- [Generation log](/guides/generation-log/): listing, downloads, signed links
