#!/usr/bin/env bash
# Client-edition only: backs up the existing database/files and replaces its API/web build.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
test -s .env
test -d web/dist/assets
archive="${1:-}"
case "$archive" in
  /opt/relay-client/backups/proposal-client-src-*.tar.gz) test -s "$archive" ;;
  *) echo 'Expected a client proposal source archive under /opt/relay-client/backups' >&2; exit 2 ;;
esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/proposal-before-$stamp"
mkdir -m 700 "$backup"
stage="$(mktemp -d /opt/relay-client/backups/proposal-stage.XXXXXX)"
mutated=0
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
rollback() {
  code=$?
  trap - ERR
  if [ "$mutated" = 1 ]; then
    echo 'Client update failed; restoring its prior API and web build.' >&2
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client || true
    docker image tag "relay-client-api:pre-proposal-$stamp" relay-client-api:latest || true
    dc up -d --no-deps --force-recreate api || true
  fi
  exit "$code"
}
trap rollback ERR
dc exec -T db pg_dump -U relay -d relay > "$backup/database.sql"
chmod 600 "$backup/database.sql"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations backend/alembic.ini backend/requirements.txt deploy/Dockerfile web/dist
chmod 600 "$backup/files.tar.gz"
docker image tag relay-client-api:latest "relay-client-api:pre-proposal-$stamp"
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/main.py"
test -s "$stage/web/dist/index.html"
mutated=1
cp -a "$stage/backend/app/." backend/app/
cp -a "$stage/backend/migrations/." backend/migrations/
install -m 644 "$stage/backend/alembic.ini" backend/alembic.ini
install -m 644 "$stage/backend/requirements.txt" backend/requirements.txt
install -m 644 "$stage/deploy/Dockerfile" deploy/Dockerfile
dc build api
dc run --rm --no-deps api python -m alembic upgrade head
dc run --rm --no-deps api python -m app.proposal_seed
dc up -d --no-deps api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 4 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
cp -a "$stage/web/dist/assets/." web/dist/assets/
install -m 644 "$stage/web/dist/index.html" web/dist/index.html
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/api/health >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/ >/dev/null
trap - ERR
echo "Client proposal deployed; backup=$backup"
