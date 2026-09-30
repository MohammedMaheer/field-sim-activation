#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
name="relay_rigorous_qa_$(date -u +%Y%m%d%H%M%S)"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test -z "$(docker ps -aq --filter name=^relay-client-rigorous-qa$)"
test -z "$(ss -ltn 'sport = :8120' | tail -n +2)"
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $name"
cleanup_error() {
  docker rm -f relay-client-rigorous-qa >/dev/null 2>&1 || true
  dc exec -T db psql -U relay -d postgres -c "DROP DATABASE IF EXISTS $name" || true
}
trap cleanup_error ERR
dc run -d --no-deps --name relay-client-rigorous-qa -p 127.0.0.1:8120:8000 \
  -e RELAY_QA_DATABASE="$name" -v /opt/relay-client/backups/qa-start.py:/tmp/qa-start.py:ro api python /tmp/qa-start.py
printf '%s\n' "$name" > /opt/relay-client/backups/rigorous-qa-database.txt
chmod 600 /opt/relay-client/backups/rigorous-qa-database.txt
trap - ERR
echo "Isolated QA instance started; database=$name"
