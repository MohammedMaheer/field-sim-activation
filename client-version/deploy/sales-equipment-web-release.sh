#!/usr/bin/env bash
# Replace only the Relay client web bundle, with restorable web and database backups.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive=/opt/relay-client/backups/sales-equipment-web.tar.gz
test -s "$archive"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/sales-equipment-web-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/sales-equipment-stage.XXXXXX)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
test -s "$stage/dist/index.html"
test -s "$stage/dist/mobile-demo/index.html"
test -s "$stage/dist/mobile-demo/main.dart.js"
tar -czf "$backup/web-dist.tar.gz" -C web dist
docker compose --env-file .env -f deploy/compose.yaml --project-directory . exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
docker compose --env-file .env -f deploy/compose.yaml --project-directory . exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup"/*
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    tar -xzf "$backup/web-dist.tar.gz" -C web
    echo "Web bundle restored from $backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
changed=1
cp -a "$stage/dist/." web/dist/
base=https://relay-client.187-127-162-233.sslip.io
curl -fsSL --max-time 15 "$base/equipment" | grep -q '<div id="root"'
curl -fsS --max-time 15 "$base/mobile-demo/" | grep -q 'Interactive phone'
js="$(sed -nE 's/.*src="(\/assets\/[^"]+\.js)".*/\1/p' web/dist/index.html | head -n 1)"
test -n "$js"
curl -fsS --max-time 15 -o /dev/null "$base$js"
trap - ERR
echo "Relay client web release complete; backup=$backup"
