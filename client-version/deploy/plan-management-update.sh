#!/usr/bin/env bash
# Client-only release for admin plan management.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/plan-management-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
test -s .env
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/plan-management-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/plan-management-stage.XXXXXX)"
mkdir -m 700 "$backup"
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = "007"
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
chmod 600 "$backup/database.dump" "$backup/database.manifest"
tar -czf "$backup/files.tar.gz" backend/app backend/migrations backend/alembic.ini backend/requirements.txt deploy/Dockerfile web/dist downloads/relay-client-scope.apk
chmod 600 "$backup/files.tar.gz"
docker image tag relay-client-api:latest "relay-client-api:pre-plan-management-$stamp"
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/main.py"
test -s "$stage/backend/migrations/versions/008_admin_plan_management.py"
test -s "$stage/web/dist/index.html"
test -s "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/downloads/relay-client-scope.apk"
changed=0
migrated=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    if [ "$migrated" = 1 ]; then dc run --rm --no-deps api python -m alembic downgrade 007 || true; fi
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-plan-management-$stamp" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Plan management release rolled back; backup=$backup" >&2
  fi
  exit "$code"
}
trap rollback ERR
changed=1
cp -a "$stage/backend/app/." backend/app/
cp -a "$stage/backend/migrations/." backend/migrations/
install -m 644 "$stage/backend/alembic.ini" backend/alembic.ini
install -m 644 "$stage/backend/requirements.txt" backend/requirements.txt
install -m 644 "$stage/deploy/Dockerfile" deploy/Dockerfile
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
install -D -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
test "$(revision)" = "008"
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/api/health >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/api/public/plans >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/ >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/plans >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/mobile-demo/ >/dev/null
curl -fsS --max-time 10 -o /dev/null https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk
trap - ERR
echo "Plan management release complete; backup=$backup"
