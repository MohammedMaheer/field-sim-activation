#!/usr/bin/env bash
# Scoped client release: identity extraction, web camera and APK. No migration.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/document-auto-scan-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
test -s .env
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 009
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/document-auto-scan-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/document-auto-scan-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup/database.dump" "$backup/database.manifest"
tar -czf "$backup/files.tar.gz" backend/app/captures.py web/dist downloads/relay-client-scope.apk
chmod 600 "$backup/files.tar.gz"
docker image tag relay-client-api:latest "relay-client-api:pre-auto-scan-$stamp"
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/captures.py"
test -s "$stage/web/dist/index.html"
test -s "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/downloads/relay-client-scope.apk"
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    dc stop api || true
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-auto-scan-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client release rolled back; backup=$backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
changed=1
install -m 644 "$stage/backend/app/captures.py" backend/app/captures.py
dc build api
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 009
cp -a "$stage/web/dist/." web/dist/
install -D -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 10 "$base/api/health" >/dev/null
curl -fsS --max-time 10 "$base/" >/dev/null
curl -fsS --max-time 10 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 10 -o /dev/null "$base/downloads/relay-client-scope.apk"
trap - ERR
echo "Client auto-scan release complete; backup=$backup"
