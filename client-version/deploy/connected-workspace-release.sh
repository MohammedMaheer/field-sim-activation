#!/usr/bin/env bash
# Narrow client API/web release; no schema change.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/connected-workspace-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1)" = 010
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/connected-workspace-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/connected-workspace-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
test -s "$backup/database.dump"
tar -czf "$backup/files.tar.gz" backend/app/sim_scanning.py web/dist
chmod 600 "$backup"/*
docker image tag relay-client-api:latest "relay-client-api:pre-connected-$stamp"
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/sim_scanning.py"
test -s "$stage/web/dist/index.html"
test -s "$stage/web/dist/mobile-demo/index.html"
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    dc stop api || true
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-connected-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client API/web rolled back; backup=$backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
changed=1
cp -a "$stage/backend/app/sim_scanning.py" backend/app/sim_scanning.py
dc build api
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
cp -a "$stage/web/dist/." web/dist/
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 "$base/api/health" >/dev/null
trap - ERR
echo "Connected client release published; backup=$backup"
