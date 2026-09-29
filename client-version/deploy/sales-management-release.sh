#!/usr/bin/env bash
# Install only the Relay client edition after a restorable database and file backup.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/sales-management-*.tar.gz) test -s "$archive";; *) exit 2;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 010
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/sales-management-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/sales-management-stage.XXXXXX)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
for file in backend/app/sales_management.py backend/app/field_assets.py backend/app/sales_seed.py backend/migrations/versions/011_sales_management.py web/dist/index.html web/dist/mobile-demo/index.html web/dist/mobile-demo/main.dart.js downloads/relay-client-scope.apk; do
  test -s "$stage/$file"
done
grep -q 'Interactive phone' "$stage/web/dist/mobile-demo/index.html"
docker image tag relay-client-api:latest "relay-client-api:pre-sales-$stamp"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations web/dist downloads/relay-client-scope.apk
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    dc stop api || true
    dc exec -T db psql -U relay -d relay -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS field_asset_requests, field_asset_movements, field_assets, sales_call_attempts, sales_targets, no_sale_feedback, sales_records CASCADE' || true
    dc exec -T db pg_restore -U relay -d relay --clean --if-exists --no-owner < "$backup/database.dump" || true
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-sales-$stamp" relay-client-api:latest
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
for file in captures.py client_scope.py db.py main.py sales_management.py field_assets.py sales_seed.py; do
  install -m 644 "$stage/backend/app/$file" "backend/app/$file"
done
install -m 644 "$stage/backend/migrations/versions/011_sales_management.py" backend/migrations/versions/011_sales_management.py
dc build api
dc run --rm --no-deps api python -m alembic upgrade head
dc run --rm --no-deps -e RELAY_SEED_SALES=YES api python -m app.sales_seed
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 011
cp -a "$stage/web/dist/." web/dist/
install -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/api/health" >/dev/null
curl -fsS --max-time 15 "$base/sales" >/dev/null
curl -fsSL --max-time 15 "$base/equipment" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 -o /dev/null "$base/downloads/relay-client-scope.apk"
trap - ERR
echo "Client sales-management release complete; backup=$backup"
