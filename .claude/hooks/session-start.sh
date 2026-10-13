#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: Node 24, dependencies, the Chromium revision
# playwright-core pins, and a local Postgres with apps/api/.env, so `pnpm test`, `pnpm dev` and
# screenshots work. Idempotent; does nothing outside cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
log() { echo "[session-start] $*" >&2; }

# --- Node (package.json engines: >=24) ---
NODE_MAJOR=24
NODE_DIR=/opt/node${NODE_MAJOR}
if ! "$NODE_DIR/bin/node" -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  version=$(curl -fsSL https://nodejs.org/dist/index.json |
    python3 -c "import json,sys; print(next(v['version'] for v in json.load(sys.stdin) if v['version'].startswith('v${NODE_MAJOR}.')))")
  log "installing Node $version"
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" |
    tar -xJ -C "$NODE_DIR" --strip-components=1
fi
export PATH="$NODE_DIR/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qs "$NODE_DIR/bin" "$CLAUDE_ENV_FILE"; then
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi

# --- Dependencies ---
log "pnpm install"
pnpm install --prefer-offline >&2

# --- Chromium headless shell at the revision playwright-core pins ---
# cdn.playwright.dev is blocked here, so `chromium:install` fails; the same Chrome for Testing build
# comes from storage.googleapis.com. It goes in PLAYWRIGHT_BROWSERS_PATH and is linked into the
# default cache, for processes spawned without that variable (scripts/bench, scripts/demo).
read -r revision browser_version < <(node -e '
  const { createRequire } = require("node:module");
  const req = createRequire(require.resolve("./apps/api/package.json"));
  const dir = require("node:path").dirname(req.resolve("playwright-core/package.json"));
  const b = require(dir + "/browsers.json").browsers.find((b) => b.name === "chromium-headless-shell");
  console.log(b.revision, b.browserVersion);')
shell_name="chromium_headless_shell-$revision"
browsers="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
target="$browsers/$shell_name"
if [ ! -x "$target/chrome-headless-shell-linux64/chrome-headless-shell" ]; then
  log "installing Chrome headless shell $browser_version (revision $revision)"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/shell.zip" \
    "https://storage.googleapis.com/chrome-for-testing-public/$browser_version/linux64/chrome-headless-shell-linux64.zip"
  mkdir -p "$target"
  unzip -q -o "$tmp/shell.zip" -d "$target"
  touch "$target/INSTALLATION_COMPLETE" "$target/DEPENDENCIES_VALIDATED"
  rm -rf "$tmp"
fi
if [ "$browsers" != "$HOME/.cache/ms-playwright" ]; then
  mkdir -p "$HOME/.cache/ms-playwright"
  ln -sfn "$target" "$HOME/.cache/ms-playwright/$shell_name"
fi

# --- Postgres (the container ships one; the repo targets 18, migrations run on 16) ---
cluster=$(pg_lsclusters --no-header 2>/dev/null | head -1 || true)
if [ -n "$cluster" ]; then
  read -r pg_version pg_name _ pg_status _ <<<"$cluster"
  if [ "$pg_status" != "online" ]; then
    log "starting Postgres $pg_version/$pg_name"
    pg_ctlcluster "$pg_version" "$pg_name" start
  fi
  su postgres -c "psql -q -v ON_ERROR_STOP=1" <<'SQL'
SELECT 'CREATE ROLE necodoc LOGIN PASSWORD ''necodoc'' CREATEDB'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'necodoc')\gexec
SELECT 'CREATE DATABASE necodoc OWNER necodoc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'necodoc')\gexec
SQL
  if [ ! -f apps/api/.env ]; then
    cp apps/api/.env.example apps/api/.env
    sed -i "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$(openssl rand -hex 32)#" apps/api/.env
  fi
  log "migrating"
  pnpm db:migrate >&2
else
  log "no Postgres cluster found; tests run without one, the API needs DATABASE_URL"
fi

log "ready"
