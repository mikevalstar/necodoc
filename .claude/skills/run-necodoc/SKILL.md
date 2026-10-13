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

## Before and after screenshots for a PR

AGENTS.md asks every PR that changes the UI to show the affected screens before and after.

1. **Before**, on the base commit: with the API and app running, `git stash` (or check out
   `origin/main`), let Vite reload, and screenshot each affected page to `before-<page>.png`.
   Seed demo data first when an empty database wouldn't show the change.
2. **After**: restore your work (`git stash pop` / your branch) and take `after-<page>.png` with the
   same path, account and viewport.
3. **Host** them on the `pr-screenshots` branch (never merged), in a folder named after your PR
   branch:

   ```bash
   B=$(git branch --show-current); W=$(mktemp -d)/shots
   git fetch origin pr-screenshots:refs/remotes/origin/pr-screenshots
   git worktree add --detach "$W" origin/pr-screenshots
   mkdir -p "$W/$B" && cp before-*.png after-*.png "$W/$B/"
   git -C "$W" add -A && git -C "$W" commit -m "Screenshots for $B"
   git -C "$W" push origin HEAD:pr-screenshots
   echo "https://raw.githubusercontent.com/mikevalstar/necodoc/$(git -C "$W" rev-parse --short HEAD)/$B/"
   git worktree remove "$W"
   ```

4. **Embed** them in the PR description as a table, one row per page, under the printed URL.
   Link by commit, not by branch name: raw.githubusercontent.com caches branch URLs for minutes
   (404 right after a push), and a commit link keeps showing these images if the folder changes.

   ```markdown
   | Before | After |
   | --- | --- |
   | ![](https://raw.githubusercontent.com/mikevalstar/necodoc/<commit>/<branch>/before-templates.png) | ![](https://raw.githubusercontent.com/mikevalstar/necodoc/<commit>/<branch>/after-templates.png) |
   ```

Read each PNG before posting to check it shows the change, not a blank or loading screen.
