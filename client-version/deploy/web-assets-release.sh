#!/usr/bin/env bash
# Publish only the client web assets after backing up the client database and site.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/client-web-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1)" = 010
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/client-web-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/client-web-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
test -s "$backup/database.dump"
tar -czf "$backup/web.tar.gz" web/dist
chmod 600 "$backup"/*
tar -xzf "$archive" -C "$stage"
test -s "$stage/dist/index.html"
test -s "$stage/dist/mobile-demo/index.html"
rollback() {
  code=$?
  trap - ERR
  tar -xzf "$backup/web.tar.gz" -C /opt/relay-client
  echo "Client web assets rolled back; backup=$backup" >&2
  exit "$code"
}
trap rollback ERR
cp -a "$stage/dist/." web/dist/
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 "$base/api/health" >/dev/null
trap - ERR
echo "Client web assets published; backup=$backup"
