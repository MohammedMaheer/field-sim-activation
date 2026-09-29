#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Release archive required}"
case "$archive" in /opt/relay-client/backups/screenshot-order-*.tar.gz) test -s "$archive";; *) exit 2;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n1)" = 010
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/screenshot-order-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/screenshot-order-stage.XXXXXX)"
mkdir -m700 "$backup"
tar -czf "$backup/files.tar.gz" backend/app web/dist downloads/relay-client-scope.apk
docker image tag relay-client-api:latest "relay-client-api:pre-order-$stamp"
changed=0
rollback() {
 code=$?; trap - ERR
 if [ "$changed" = 1 ]; then
  dc stop api || true
  tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
  dc exec -T db pg_restore -U relay -d relay --clean --if-exists < "$backup/database.dump"
  docker image tag "relay-client-api:pre-order-$stamp" relay-client-api:latest
 fi
 dc up -d --no-deps --force-recreate api
 echo "Client rollback completed; backup=$backup" >&2
 exit "$code"
}
trap rollback ERR
dc stop api
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup"/*
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/captures.py"
test -s "$stage/web/dist/mobile-demo/main.dart.js"
test -s "$stage/downloads/relay-client-scope.apk"
changed=1
for file in captures.py invoices.py organization.py branch_leaders.py; do cp "$stage/backend/app/$file" "backend/app/$file"; done
dc build api
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
 if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
 sleep 2
done
test "$healthy" = 1
dc exec -T -e RELAY_ASSIGN_SAMPLE_BRANCH_LEADERS=YES api python -m app.branch_leaders
cp -a "$stage/web/dist/." web/dist/
cp "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/api/health" >/dev/null
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
trap - ERR
echo "Screenshot-order release published; backup=$backup"
