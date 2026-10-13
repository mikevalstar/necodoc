---
name: run-necodoc
description: Start necodoc's API and app in a Claude Code cloud session, seed demo data, and screenshot app pages. Use when asked to run, start, demo or screenshot the app, or to check a change in the real app.
---

# Running necodoc in a cloud session

`.claude/hooks/session-start.sh` has already installed Node 24, dependencies, the pinned Chromium
headless shell and a local Postgres with `apps/api/.env` (database `necodoc`, migrated). If
`node -v` isn't 24, run `export PATH=/opt/node24/bin:$PATH`.

## Start

Run each in the background and wait for it to answer:

```bash
pnpm --filter @necodoc/api dev   # :3000, health at /api/health
pnpm --filter @necodoc/app dev   # :5173, proxies /api
```

Don't use `pkill -f` with a pattern from your own command line: it kills the shell running it.
Stop servers by PID (`ps aux | grep -E "tsx|vite"`).

## Sign in

The first account to sign up becomes admin. On an empty database:

```bash
curl -s -X POST localhost:5173/api/auth/sign-up/email -H 'content-type: application/json' \
  -H 'origin: http://localhost:5173' \
  -d '{"email":"admin@admin.com","password":"admin1234","name":"Admin"}'
```

## Demo data (optional, ~75 s)

For screens with real templates, documents and history, seed a separate database (the seed refuses
the one in `apps/api/.env`) and point the API at it:

```bash
su postgres -c "createdb -O necodoc necodoc_demo"
DEMO_DATABASE_URL=postgres://necodoc:necodoc@localhost:5432/necodoc_demo pnpm demo:seed
sed -i 's#^DATABASE_URL=.*#DATABASE_URL=postgres://necodoc:necodoc@localhost:5432/necodoc_demo#' apps/api/.env
```

Restart the API, then sign in as `demo@necodoc.com` / `harbour-demo-2026`.

## Screenshot

```bash
node .claude/skills/run-necodoc/screenshot.mjs /templates /tmp/templates.png
NECODOC_EMAIL=demo@necodoc.com NECODOC_PASSWORD=harbour-demo-2026 \
  node .claude/skills/run-necodoc/screenshot.mjs /documents /tmp/documents.png
```

Then Read the PNG to look at it.
