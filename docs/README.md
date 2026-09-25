# necodoc

A web tool for filling out documents: users answer guided forms and get a finished PDF. Think GhostDraft, aimed at being simpler.

## Goals

- Filling out a document should feel like answering questions, not wrestling a PDF.
- Validation rules are defined once and shared between the browser and the server.
- Keep the stack small: one SPA, one API, one database.

## Layout

| Path | Purpose |
| --- | --- |
| [apps/web](../apps/web) | Marketing/static site (Astro). No app logic. |
| [apps/app](../apps/app) | The document-filling SPA (TanStack Router, Query, Form, shadcn). |
| [apps/api](../apps/api) | HTTP API (Hono), database (Drizzle + Postgres), auth (Better Auth). |
| [packages/shared](../packages/shared) | Zod schemas and types used by both app and api. |

## Decisions

- **Typed API without codegen:** the app calls the api through Hono's RPC client, typed from [`AppType`](../apps/api/src/app.ts). See [apps/app/src/lib/api.ts](../apps/app/src/lib/api.ts).
- **Same-origin auth:** the app talks to `/api` on its own origin (Vite proxy in dev, see [vite.config.ts](../apps/app/vite.config.ts)), so Better Auth cookies stay first-party.
- **Shared package ships TS source:** no build step; consumers bundle it (Vite, tsdown).
- **No task runner:** `pnpm -r` / `--filter` until builds are slow enough to justify Turborepo.
- **TypeScript 7** everywhere except `apps/web`, which stays on TS 6 because `@astrojs/check` doesn't support 7 yet.

## Open questions

- **PDF model:** fill existing AcroForm PDFs (pdf-lib), generate from templates (Typst / react-pdf / HTML→PDF), or both. Undecided; no PDF library is installed yet.
- **Deployment target:** assumed Node for now ([apps/api/src/index.ts](../apps/api/src/index.ts)).
- **Document storage** for uploaded/generated PDFs (S3/R2/disk): not needed until uploads exist.
