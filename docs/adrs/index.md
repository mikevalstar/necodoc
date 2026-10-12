# Architecture Decision Records

Numbered records of significant, hard-to-reverse decisions. List them:

    okq find --type adr

Add one with `okq new adr "<title>"`.

<!-- okq:index:begin -->
### Concepts

| Title | File |
|-------|------|
| Record architecture decisions | [0001-record-architecture-decisions.md](0001-record-architecture-decisions.md) |
| pnpm workspaces monorepo | [0002-pnpm-workspaces-monorepo.md](0002-pnpm-workspaces-monorepo.md) |
| Astro for the marketing site | [0003-astro-for-the-marketing-site.md](0003-astro-for-the-marketing-site.md) |
| Frontend stack: React SPA with TanStack Router, Query, Form and shadcn | [0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md](0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md) |
| Hono API on Node, typed through its RPC client | [0005-hono-api-on-node-typed-through-its-rpc-client.md](0005-hono-api-on-node-typed-through-its-rpc-client.md) |
| Postgres with Drizzle | [0006-postgres-with-drizzle.md](0006-postgres-with-drizzle.md) |
| Better Auth for authentication | [0007-better-auth-for-authentication.md](0007-better-auth-for-authentication.md) |
| Zod schemas shared between API and app | [0008-zod-schemas-shared-between-api-and-app.md](0008-zod-schemas-shared-between-api-and-app.md) |
| Biome for linting and formatting | [0009-biome-for-linting-and-formatting.md](0009-biome-for-linting-and-formatting.md) |
| TypeScript 7 | [0010-typescript-7.md](0010-typescript-7.md) |
| Role-based access with the Better Auth admin plugin | [0011-role-based-access-with-the-better-auth-admin-plugin.md](0011-role-based-access-with-the-better-auth-admin-plugin.md) |
| Headless Chromium for HTML to PDF | [0012-headless-chromium-for-html-to-pdf.md](0012-headless-chromium-for-html-to-pdf.md) |
| pdf-lib for overlaying, stamping and merging PDFs | [0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md](0013-pdf-lib-for-overlaying-stamping-and-merging-pdfs.md) |
| Binary files stored in Postgres | [0014-binary-files-stored-in-postgres.md](0014-binary-files-stored-in-postgres.md) |
| LiquidJS for templating | [0015-liquidjs-for-templating.md](0015-liquidjs-for-templating.md) |
| TipTap for the document editor | [0016-tiptap-for-the-document-editor.md](0016-tiptap-for-the-document-editor.md) |
| pdf.js for PDF rendering in the app | [0017-pdf-js-for-pdf-rendering-in-the-app.md](0017-pdf-js-for-pdf-rendering-in-the-app.md) |
| Claude API for AI field detection and drafting | [0018-claude-api-for-ai-field-detection-and-drafting.md](0018-claude-api-for-ai-field-detection-and-drafting.md) |
| Better Auth API keys for the public API | [0019-better-auth-api-keys-for-the-public-api.md](0019-better-auth-api-keys-for-the-public-api.md) |
| pg-boss job queue and separate render worker processes | [0020-pg-boss-job-queue-and-separate-render-worker-processes.md](0020-pg-boss-job-queue-and-separate-render-worker-processes.md) |
| TanStack Table for server-side data tables | [0021-tanstack-table-for-server-side-data-tables.md](0021-tanstack-table-for-server-side-data-tables.md) |
| Vercel AI SDK for all AI features | [0022-vercel-ai-sdk-for-all-ai-features.md](0022-vercel-ai-sdk-for-all-ai-features.md) |
| Generated outputs in object storage | [0023-generated-outputs-in-object-storage.md](0023-generated-outputs-in-object-storage.md) |
| CodeMirror 6 for code mode and raw HTML blocks | [0024-codemirror-6-for-code-mode-and-raw-html-blocks.md](0024-codemirror-6-for-code-mode-and-raw-html-blocks.md) |
| Container images, Compose and Helm for self-hosting | [0025-container-images-compose-and-helm-for-self-hosting.md](0025-container-images-compose-and-helm-for-self-hosting.md) |
| Astro Starlight for the developer docs site | [0026-astro-starlight-for-the-developer-docs-site.md](0026-astro-starlight-for-the-developer-docs-site.md) |
| Encrypted PDFs with an empty password open through a patched pdf-lib | [0027-encrypted-pdfs-with-an-empty-password-open-through-a-patched-pdf-lib.md](0027-encrypted-pdfs-with-an-empty-password-open-through-a-patched-pdf-lib.md) |
| Server-side PDF extraction and AI field detection as a queue job | [0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md](0028-server-side-pdf-extraction-and-ai-field-detection-as-a-queue-job.md) |
| Service accounts and scoped API keys | [0029-service-accounts-and-scoped-api-keys.md](0029-service-accounts-and-scoped-api-keys.md) |
| OpenAPI for the public API with hono-openapi | [0030-openapi-for-the-public-api-with-hono-openapi.md](0030-openapi-for-the-public-api-with-hono-openapi.md) |
| Single sign-on with the Better Auth SSO plugin, configured from env | [0031-single-sign-on-with-the-better-auth-sso-plugin-configured-from-env.md](0031-single-sign-on-with-the-better-auth-sso-plugin-configured-from-env.md) |
| Append-only audit log with a request-scoped actor | [0032-append-only-audit-log-with-a-request-scoped-actor.md](0032-append-only-audit-log-with-a-request-scoped-actor.md) |
| Sign boxes located by anchor text, handed off to e-sign providers | [0033-sign-boxes-located-by-anchor-text-handed-off-to-e-sign-providers.md](0033-sign-boxes-located-by-anchor-text-handed-off-to-e-sign-providers.md) |
| Hand-rolled SVG charts | [0034-hand-rolled-svg-charts.md](0034-hand-rolled-svg-charts.md) |
| AI assistant proposes changes as client-side tool calls | [0035-ai-assistant-proposes-changes-as-client-side-tool-calls.md](0035-ai-assistant-proposes-changes-as-client-side-tool-calls.md) |
| pino logs, Prometheus metrics and opt-in OpenTelemetry traces | [0036-pino-logs-prometheus-metrics-and-opt-in-opentelemetry-traces.md](0036-pino-logs-prometheus-metrics-and-opt-in-opentelemetry-traces.md) |
| PDF/A-2 and PDF/UA-1 by post-processing Chromium output in pdf-lib | [0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md](0037-pdf-a-2-and-pdf-ua-1-by-post-processing-chromium-output-in-pdf-lib.md) |
| PAdES certification signatures built with PKI.js | [0038-pades-certification-signatures-built-with-pki-js.md](0038-pades-certification-signatures-built-with-pki-js.md) |
| Sensitive fields masked outside stored inputs, erasure by data subject | [0039-sensitive-fields-masked-outside-stored-inputs-erasure-by-data-subject.md](0039-sensitive-fields-masked-outside-stored-inputs-erasure-by-data-subject.md) |
| One document language and source-text translation tables | [0040-one-document-language-and-source-text-translation-tables.md](0040-one-document-language-and-source-text-translation-tables.md) |
<!-- okq:index:end -->
