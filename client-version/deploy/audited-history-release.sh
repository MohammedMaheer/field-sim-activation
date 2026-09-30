#!/usr/bin/env bash
# Preserve saved leader access after transfers; no schema or stored-record rewrite.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
source_file=/opt/relay-client/backups/audited-captures.py
test -s "$source_file"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test "$(dc exec -T api python -m alembic current | tr -d '\r')" = '014 (head)'
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/audit-history-before-$stamp"
mkdir -m 700 "$backup"
cp -a backend/app/captures.py "$backup/captures.py"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
chmod 600 "$backup"/*
docker image tag relay-client-api:latest "relay-client-api:pre-audit-history-$stamp"
rollback() {
 code=$?; trap - ERR
 cp -a "$backup/captures.py" backend/app/captures.py
 docker image tag "relay-client-api:pre-audit-history-$stamp" relay-client-api:latest
 dc up -d --no-deps --force-recreate api
 exit "$code"
}
trap rollback ERR
install -m 644 "$source_file" backend/app/captures.py
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
echo "Historical leader scope correction complete; backup=$backup"
