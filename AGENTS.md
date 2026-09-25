# necodoc

A web tool for filling out documents: users answer a guided form and get a
completed PDF, similar to GhostDraft
([spec](docs/features/filling-out-a-document.md)). The PDF model is still open.
Don't add a PDF library until an ADR settles it.

## Architecture

pnpm workspaces monorepo ([ADR 0002](docs/adrs/0002-pnpm-workspaces-monorepo.md)):

- `apps/web`: static Astro marketing site, no app logic
  ([ADR 0003](docs/adrs/0003-astro-for-the-marketing-site.md)).
- `apps/app`: React SPA. It uses TanStack Router (file routes in `src/routes`),
  Query, Form, shadcn on Base UI, and dayjs through `src/lib/date.ts`
  ([ADR 0004](docs/adrs/0004-frontend-stack-react-spa-with-tanstack-router-query-form-and-shadcn.md)).
  It calls the API only through `src/lib/api.ts` (Hono RPC client) and
  handles auth through `src/lib/auth.ts`.
- `apps/api`: Hono on Node with every route under `/api`
  ([ADR 0005](docs/adrs/0005-hono-api-on-node-typed-through-its-rpc-client.md)).
  Drizzle + Postgres ([ADR 0006](docs/adrs/0006-postgres-with-drizzle.md)),
  Better Auth ([ADR 0007](docs/adrs/0007-better-auth-for-authentication.md)).
  `src/app.ts` exports `AppType`; keep routes chained on that instance so
  the client stays typed.
- `packages/shared`: browser-safe zod schemas for every payload and form.
  Types come from `z.infer`, never hand-written
  ([ADR 0008](docs/adrs/0008-zod-schemas-shared-between-api-and-app.md)).

## Documentation-first (OKF)

`docs/` is an [Open Knowledge Format 0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
([local copy](docs/external/okf-spec-0.2.md)) bundle: Markdown + YAML
frontmatter, one concept per file, maintained with
[okq](https://github.com/mikevalstar/okq). **Before implementing a feature or
making an architectural choice, write or update the relevant doc:**

- New tech, library or architecture choice → ADR: `okq --bundle docs new adr "<title>"`
- New user-visible capability → spec: `okq --bundle docs new feature "<title>"`

Rules:

- All docs carry YAML frontmatter (`type`, `title`, `description`, `tags`,
  `status`); never omit it. Cross-link related docs so the graph stays
  connected. Link to code files rather than describing code.
- Docs record intent and goals, so reviews can spot requirements drift. No
  styling detail, no rambling.
- ADRs are numbered and immutable: supersede them, don't rewrite them.
- `docs/external/` holds verbatim snapshots. Don't edit the bodies; re-snapshot
  and bump `retrieved` instead.
- Read the bundle with okq rather than grep: `okq --bundle docs search
  "<topic>"`, `okq --bundle docs find --type adr`, `okq --bundle docs stats`.
- After adding or renaming docs, run `okq --bundle docs index`, then
  `pnpm docs:check` (validate + deadlinks + lint) before committing.

## Commands

- `pnpm dev`: web :4321, app :5173 (proxies `/api`), api :3000
- `pnpm check` / `pnpm fix`: Biome lint + format, no writes / apply
- `pnpm typecheck`, `pnpm test` (Vitest), `pnpm build`
- `pnpm docs:check`: validate the `docs/` bundle (needs `okq` on PATH)
- `pnpm db:generate` / `pnpm db:migrate`: Drizzle migrations (committed in `apps/api/drizzle`)
- `pnpm --filter @necodoc/api auth:generate`: regenerate Better Auth tables after changing plugins
- shadcn components: `cd apps/app && pnpm dlx shadcn@latest add <name>`

## Gotchas

- Local Postgres 18 runs natively through Homebrew (`brew services start
  postgresql@18`), not Docker. The connection string is in `apps/api/.env`
  (see `.env.example`), and env vars are validated in `apps/api/src/env.ts`.
- `apps/api/src/db/auth-schema.ts` and `apps/app/src/routeTree.gen.ts` are
  generated. Don't hand-edit them; `routeTree.gen.ts` is committed so
  typecheck works without a build.
- TypeScript 7 everywhere except `apps/web` (TS 6 for `astro check`). TS 7 has
  no `baseUrl`, and `types` must be listed per tsconfig
  ([ADR 0010](docs/adrs/0010-typescript-7.md)).
- Biome skips lint in `apps/app/src/components/ui` (vendored shadcn) and the
  unused-code rules in `.astro` files
  ([ADR 0009](docs/adrs/0009-biome-for-linting-and-formatting.md)).
- Workspace packages ship TS source. The API build (tsdown) inlines
  `@necodoc/*`; keep that `noExternal` rule if you add packages.
