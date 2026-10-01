#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive=/opt/relay-client/backups/role-access-source.tar.gz
test -s "$archive"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1)" = 014
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/role-access-before-$stamp"
mkdir -m 700 "$backup"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
tar -czf "$backup/backend.tar.gz" backend/app
chmod 600 "$backup"/*
docker image tag relay-client-api:latest "relay-client-api:pre-role-access-$stamp"
rollback() {
 code=$?; trap - ERR
 tar -xzf "$backup/backend.tar.gz" -C /opt/relay-client
 docker image tag "relay-client-api:pre-role-access-$stamp" relay-client-api:latest
 dc up -d --no-deps --force-recreate api
 exit "$code"
}
trap rollback ERR
tar -xzf "$archive" -C /opt/relay-client
dc build api
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
 if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
 sleep 2
done
test "$healthy" = 1
curl -fsS --max-time 15 https://relay-client.187-127-162-233.sslip.io/api/health >/dev/null
trap - ERR
echo "Role access deployed; backup=$backup"
