#!/usr/bin/env bash
# Existing client deployment only. The earlier full edition is independent.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected a release archive}"
case "$archive" in /opt/relay-client/backups/premium-client-*.tar.gz) test -s "$archive";; *) exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/premium-before-$stamp"
mkdir -m 700 "$backup"
stage="$(mktemp -d /opt/relay-client/backups/premium-stage.XXXXXX)"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
dc exec -T db pg_dump -U relay -d relay > "$backup/database.sql"
chmod 600 "$backup/database.sql"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations backend/alembic.ini backend/requirements.txt deploy/Dockerfile web/dist
docker image tag relay-client-api:latest "relay-client-api:pre-premium-$stamp"
migrated=0
rollback() {
  code=$?
  trap - ERR
  if [ "$migrated" = 1 ]; then dc run --rm --no-deps api python -m alembic downgrade 004; fi
  tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
  docker image tag "relay-client-api:pre-premium-$stamp" relay-client-api:latest
  dc up -d --no-deps --force-recreate api
  echo "Client release rolled back; backup=$backup" >&2
  exit "$code"
}
trap rollback ERR
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/migrations/versions/005_branches.py"
test -s "$stage/web/dist/fonts/manrope.ttf"
cp -a "$stage/backend/app/." backend/app/
cp -a "$stage/backend/migrations/." backend/migrations/
cp "$stage/backend/requirements.txt" backend/requirements.txt
cp "$stage/deploy/Dockerfile" deploy/Dockerfile
dc build api
dc stop api
dc run --rm --no-deps api python -m alembic upgrade head
migrated=1
dc up -d --no-deps api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
cp -a "$stage/web/dist/." web/dist/
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/api/health >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/fonts/manrope.ttf >/dev/null
trap - ERR
echo "Client release complete; backup=$backup"
