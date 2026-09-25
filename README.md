# necodoc

pnpm monorepo. See [docs/README.md](docs/README.md) for goals and layout.

## Getting started

Postgres 18 via Homebrew:

```sh
brew install postgresql@18 && brew services start postgresql@18
psql -d postgres -c "CREATE ROLE necodoc LOGIN PASSWORD 'necodoc'" -c "CREATE DATABASE necodoc OWNER necodoc"
```

Then:

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET
pnpm db:migrate
pnpm dev                                 # web :4321, app :5173, api :3000
```

## Scripts

- `pnpm check` / `pnpm fix`: Biome lint + format
- `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm db:generate`: Drizzle migration from schema changes
- `pnpm --filter @necodoc/api auth:generate`: regenerate Better Auth tables after changing auth plugins
