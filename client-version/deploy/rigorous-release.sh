#!/usr/bin/env bash
# Client-only release. No migrations, resets or seed operations.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected rigorous release archive}"
case "$archive" in /opt/relay-client/backups/rigorous-*.tar.gz) test -s "$archive";; *) exit 2;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 012
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/rigorous-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/rigorous-stage.XXXXXX)"
qa_db="relay_restore_qa_$(date -u +%Y%m%d%H%M%S)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
for file in main.py field_assets.py sales_management.py proposal.py validation.py; do test -s "$stage/backend/app/$file"; done
for file in web/dist/index.html web/dist/mobile-demo/index.html web/dist/mobile-demo/main.dart.js web/dist/mobile-demo/preview.js web/dist/mobile-demo/preview.css downloads/relay-client-scope.apk; do test -s "$stage/$file"; done
grep -q 'Interactive phone' "$stage/web/dist/mobile-demo/index.html"
grep -q 'flutter-host' "$stage/web/dist/mobile-demo/index.html"
docker image tag relay-client-api:latest "relay-client-api:pre-rigorous-$stamp"
tar -czf "$backup/files.tar.gz" backend/app web/dist downloads/relay-client-scope.apk
changed=0
rollback() {
  code=$?
  trap - ERR
  dc exec -T db psql -U relay -d postgres -c "DROP DATABASE IF EXISTS $qa_db" || true
  if [ "$changed" = 1 ]; then
    dc stop api || true
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-rigorous-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Client rollback attempted; inspect backup=$backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup"/*
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $qa_db"
dc exec -T db pg_restore -U relay -d "$qa_db" --no-owner --exit-on-error < "$backup/database.dump"
sql="select 'revision='||version_num from alembic_version; select 'accounts='||count(*) from users; select 'plans='||count(*) from plans; select 'agents='||count(*) from agents; select 'captures='||count(*) from kyc_captures; select 'sales='||count(*) from sales_records; select 'sims='||count(*) from sim_inventory;"
dc exec -T db psql -U relay -d "$qa_db" -At -v ON_ERROR_STOP=1 -c "$sql" > "$backup/restored-counts.txt"
grep -q '^revision=012$' "$backup/restored-counts.txt"
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $qa_db"
changed=1
for file in main.py field_assets.py sales_management.py proposal.py validation.py; do install -m 644 "$stage/backend/app/$file" "backend/app/$file"; done
dc build api
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
dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 -c "$sql" > "$backup/live-counts.txt"
diff "$backup/restored-counts.txt" "$backup/live-counts.txt"
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/api/health" >/dev/null
curl -fsS --max-time 15 "$base/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/" | grep -q 'Interactive phone'
curl -fsSI --max-time 15 "$base/downloads/relay-client-scope.apk" >/dev/null
sha256sum downloads/relay-client-scope.apk
trap - ERR
echo "Client rigorous release complete; backup=$backup"
