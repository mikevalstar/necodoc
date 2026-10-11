#!/bin/sh
# ADR 0025: migrations are an explicit command; `serve` only migrates when MIGRATE_ON_START=true.
set -e

case "${1:-serve}" in
  serve)
    if [ "$MIGRATE_ON_START" = "true" ]; then node /app/migrate.mjs; fi
    exec node /app/dist/index.mjs
    ;;
  migrate) exec node /app/migrate.mjs ;;
  storage-migrate) exec node /app/dist/storage-migrate.mjs ;;
  *) exec "$@" ;;
esac
