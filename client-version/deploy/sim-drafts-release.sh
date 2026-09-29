#!/usr/bin/env bash
# Client-only release with verified backup and reversible additive migration.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/sim-drafts-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 009
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/sim-drafts-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/sim-drafts-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
test -s "$backup/database.dump"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations web/dist downloads/relay-client-scope.apk
chmod 600 "$backup"/*
docker image tag relay-client-api:latest "relay-client-api:pre-sim-drafts-$stamp"
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/sim_scanning.py"
test -s "$stage/backend/migrations/versions/010_sim_progress_drafts.py"
test -s "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/downloads/relay-client-scope.apk"
changed=0
migrated=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    dc stop api || true
    if [ "$migrated" = 1 ]; then dc run --rm --no-deps api python -m alembic downgrade 009; fi
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-sim-drafts-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client release rolled back; backup=$backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
changed=1
cp -a "$stage/backend/app/." backend/app/
cp -a "$stage/backend/migrations/." backend/migrations/
dc build api
dc stop api
dc run --rm --no-deps api python -m alembic upgrade head
migrated=1
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 010
cp -a "$stage/web/dist/." web/dist/
install -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 "$base/api/health" >/dev/null
trap - ERR
echo "Client SIM/draft release complete; backup=$backup"
