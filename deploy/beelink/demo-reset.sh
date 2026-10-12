#!/usr/bin/env bash
# Nightly reset of the public demo on the Beelink (docs/features/public-demo.md, ADR 0045).
# Run from cron (crontab.txt next to this file). Rebuilds the demo from the seed; never deploys.
set -euo pipefail

REPO=/var/www/necodoc
export PATH="$HOME/.local/pnpm12/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p "$HOME/logs"
exec >>"$HOME/logs/necodoc-reset.log" 2>&1
cd "$REPO"

# One reset at a time: a slow one and the next night's never overlap.
exec 9>/tmp/necodoc-demo-reset.lock
flock -n 9 || { echo "[demo:reset $(date -Is)] another reset is running; skipped"; exit 0; }

pnpm demo:reset \
  --instance-env "$REPO/apps/api/.env" \
  --pause "pm2 stop necodoc-worker" \
  --resume "pm2 restart necodoc-api necodoc-worker"
