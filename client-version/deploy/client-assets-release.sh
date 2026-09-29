#!/usr/bin/env bash
# Publish verified client web and Android assets with a scoped rollback copy.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/client-assets-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1)" = 010
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/client-assets-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/client-assets-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
test -s "$backup/database.dump"
tar -czf "$backup/files.tar.gz" web/dist downloads/relay-client-scope.apk
chmod 600 "$backup"/*
tar -xzf "$archive" -C "$stage"
test -s "$stage/web/dist/index.html"
test -s "$stage/web/dist/mobile-demo/index.html"
grep -q 'Interactive phone' "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/web/dist/mobile-demo/preview.js"
test -s "$stage/web/dist/mobile-demo/preview.css"
test -s "$stage/downloads/relay-client-scope.apk"
rollback() {
  code=$?
  trap - ERR
  tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
  echo "Client assets rolled back; backup=$backup" >&2
  exit "$code"
}
trap rollback ERR
cp -a "$stage/web/dist/." web/dist/
install -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 -o /dev/null "$base/downloads/relay-client-scope.apk"
curl -fsS --max-time 15 "$base/api/health" >/dev/null
trap - ERR
echo "Client web and APK published; backup=$backup"
