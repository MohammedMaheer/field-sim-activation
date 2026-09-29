#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected operations release archive}"
case "$archive" in /opt/relay-client/backups/operations-*.tar.gz) test -s "$archive";; *) exit 2;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 011
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/operations-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/operations-stage.XXXXXX)"
qa_db="relay_operations_qa_$(date -u +%Y%m%d%H%M%S)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
for file in backend/app/db.py backend/app/field_assets.py backend/app/sales_management.py backend/app/operations_seed.py backend/migrations/versions/012_modern_trade_operations.py deploy/operations-migration-check.py web/dist/index.html web/dist/mobile-demo/index.html web/dist/mobile-demo/main.dart.js downloads/relay-client-scope.apk; do
  test -s "$stage/$file"
done
docker image tag relay-client-api:latest "relay-client-api:pre-operations-$stamp"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations web/dist downloads/relay-client-scope.apk
changed=0
rollback() {
  code=$?
  trap - ERR
  dc exec -T db psql -U relay -d postgres -c "DROP DATABASE IF EXISTS $qa_db" || true
  if [ "$changed" = 1 ]; then
    dc stop api || true
    dc exec -T db psql -U relay -d relay -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS sales_call_tasks, stock_thresholds CASCADE' || true
    dc exec -T db pg_restore -U relay -d relay --clean --if-exists --no-owner < "$backup/database.dump" || true
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-operations-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client rollback attempted; inspect backup=$backup" >&2
  else
    dc up -d --no-deps api || true
  fi
  exit "$code"
}
trap rollback ERR
dc stop api
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup"/*
changed=1
for file in db.py main.py security.py seed.py sales_management.py field_assets.py sales_seed.py operations_seed.py; do
  install -m 644 "$stage/backend/app/$file" "backend/app/$file"
done
install -m 644 "$stage/backend/migrations/versions/012_modern_trade_operations.py" backend/migrations/versions/012_modern_trade_operations.py
dc build api
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $qa_db"
dc exec -T db pg_restore -U relay -d "$qa_db" --no-owner --exit-on-error < "$backup/database.dump"
dc run --rm --no-deps -e RELAY_QA_DATABASE="$qa_db" -v "$stage/deploy/operations-migration-check.py:/tmp/operations-migration-check.py:ro" api python /tmp/operations-migration-check.py
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $qa_db"
dc run --rm --no-deps api python -m alembic upgrade head
dc run --rm --no-deps -e RELAY_SEED_OPERATIONS=YES api python -m app.operations_seed
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 012
next="/opt/relay-client/web/dist-next-$stamp"
test ! -e "$next"
cp -a "$stage/web/dist" "$next"
mv /opt/relay-client/web/dist "$backup/web-dist"
mv "$next" /opt/relay-client/web/dist
install -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/api/health" >/dev/null
curl -fsS --max-time 15 "$base/call-work" >/dev/null
curl -fsS --max-time 15 "$base/equipment" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsSI --max-time 15 "$base/downloads/relay-client-scope.apk" >/dev/null
trap - ERR
echo "Client operations release complete; backup=$backup"
