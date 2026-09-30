#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
stage=/opt/relay-client/backups/modern-trade-qa
test ! -e "$stage"
mkdir -m 700 "$stage"
tar -xzf /opt/relay-client/backups/modern-trade-qa.tar.gz -C "$stage"
name="relay_rigorous_qa_$(date -u +%Y%m%d%H%M%S)"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
test -z "$(docker ps -aq --filter name=^relay-client-rigorous-qa$)"
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $name"
dc run -d --no-deps --name relay-client-rigorous-qa -p 127.0.0.1:8120:8000 \
  -e RELAY_QA_DATABASE="$name" -v "$stage/deploy/qa-start.py:/tmp/qa-start.py:ro" \
  -v "$stage/backend/app:/app/app:ro" -v "$stage/backend/migrations:/app/migrations:ro" api python /tmp/qa-start.py
printf '%s\n' "$name" > "$stage/database-name.txt"
echo "Isolated Modern Trade test instance started"
