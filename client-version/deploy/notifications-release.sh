#!/usr/bin/env bash
# Client-only release; preserve all operational data, accounts and edited plans.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected Notifications release archive}"
case "$archive" in /opt/relay-client/backups/notifications-release-*.tar.gz) test -s "$archive";; *) exit 2;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 013
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/notifications-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/notifications-stage.XXXXXX)"
qa_db="relay_notifications_qa_$(date -u +%Y%m%d%H%M%S)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
for file in backend/app/main.py backend/app/db.py backend/migrations/versions/014_notification_reads.py deploy/notifications-migration-check.py web/dist/index.html web/dist/mobile-demo/index.html web/dist/mobile-demo/main.dart.js web/dist/mobile-demo/flutter_bootstrap.js downloads/relay-client-scope.apk; do test -s "$stage/$file"; done
grep -q 'flutter-host' "$stage/web/dist/mobile-demo/flutter_bootstrap.js"
! grep -q '{{flutter_js}}' "$stage/web/dist/mobile-demo/flutter_bootstrap.js"
docker image tag relay-client-api:latest "relay-client-api:pre-notifications-$stamp"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations web/dist downloads/relay-client-scope.apk
had_migration=0
test ! -f backend/migrations/versions/014_notification_reads.py || had_migration=1
changed=0
stopped=0
migrated=0
rollback() {
  code=$?
  trap - ERR
  dc exec -T db psql -U relay -d postgres -c "DROP DATABASE IF EXISTS $qa_db" || true
  if [ "$changed" = 1 ]; then
    dc stop api || true
    if [ "$migrated" = 1 ]; then
      dc run --rm --no-deps api python -m alembic downgrade 013 || dc exec -T db pg_restore -U relay -d relay --clean --if-exists --no-owner --exit-on-error < "$backup/database.dump"
    fi
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    rm -f /opt/relay-client/backend/app/notifications.py
    if [ "$had_migration" = 0 ]; then rm -f /opt/relay-client/backend/migrations/versions/014_notification_reads.py; fi
    docker image tag "relay-client-api:pre-notifications-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client rollback completed; inspect backup=$backup" >&2
  elif [ "$stopped" = 1 ]; then
    dc up -d --no-deps api || true
  fi
  exit "$code"
}
trap rollback ERR
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/rehearsal.dump"
test -s "$backup/rehearsal.dump"
changed=1
cp -a "$stage/backend/app/." backend/app/
install -m 644 "$stage/backend/migrations/versions/014_notification_reads.py" backend/migrations/versions/014_notification_reads.py
dc build api
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $qa_db"
dc exec -T db pg_restore -U relay -d "$qa_db" --no-owner --exit-on-error < "$backup/rehearsal.dump"
dc run --rm --no-deps -e RELAY_QA_DATABASE="$qa_db" -v "$stage/deploy/notifications-migration-check.py:/tmp/check.py:ro" api python /tmp/check.py
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $qa_db"
# Capture the final database snapshot with writes stopped, after building and rehearsal.
dc stop api
stopped=1
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
test -s "$backup/database.dump"
sql="select 'accounts='||count(*) from users; select 'plans='||count(*) from plans; select 'agents='||count(*) from agents; select 'captures='||count(*) from kyc_captures; select 'sales='||count(*) from sales_records; select 'sims='||count(*) from sim_inventory; select 'plans_hash='||md5(coalesce(string_agg(row_to_json(p)::text,'' order by id),'')) from plans p; select 'accounts_hash='||md5(coalesce(string_agg(row_to_json(u)::text,'' order by id),'')) from users u;"
dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 -c "$sql" > "$backup/before-counts.txt"
chmod 600 "$backup"/*
migrated=1
dc run --rm --no-deps api python -m alembic upgrade 014
dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 -c "$sql" > "$backup/after-counts.txt"
diff "$backup/before-counts.txt" "$backup/after-counts.txt"
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 014
next="/opt/relay-client/web/dist-next-$stamp"
test ! -e "$next"
cp -a "$stage/web/dist" "$next"
mv /opt/relay-client/web/dist "$backup/web-dist"
mv "$next" /opt/relay-client/web/dist
install -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/api/health" >/dev/null
curl -fsS --max-time 15 "$base/sales" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" | grep -q 'Interactive phone'
curl -fsSI --max-time 15 "$base/downloads/relay-client-scope.apk" >/dev/null
sha256sum downloads/relay-client-scope.apk
trap - ERR
echo "Notifications release complete; backup=$backup"
