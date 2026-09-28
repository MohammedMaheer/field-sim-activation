#!/usr/bin/env bash
# Owner-authorized sample reset; keep accounts and plans, scoped to client only.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected release archive}"
case "$archive" in /opt/relay-client/backups/review-samples-*.tar.gz) test -s "$archive" ;; *) exit 2 ;; esac
dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T api python -m alembic current | tr -d '\r' | sed -nE 's/^([0-9]{3}).*/\1/p' | tail -n 1; }
test "$(revision)" = 009
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/review-samples-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/review-samples-stage.XXXXXX)"
mkdir -m 700 "$backup"
# Stop writers before the backup and preserve sessions as well as credentials.
trap 'dc up -d --no-deps api; exit 1' ERR
dc stop api
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
tar -czf "$backup/files.tar.gz" backend/app web/dist downloads/relay-client-scope.apk
chmod 600 "$backup"/*
docker image tag relay-client-api:latest "relay-client-api:pre-review-$stamp"
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then
    dc stop api || true
    dc exec -T db pg_restore -U relay -d relay --clean --if-exists < "$backup/database.dump"
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "relay-client-api:pre-review-$stamp" relay-client-api:latest
  fi
  dc up -d --no-deps --force-recreate api
  echo "Client release rolled back; backup=$backup" >&2
  exit "$code"
}
trap rollback ERR
tar -xzf "$archive" -C "$stage"
test -s "$stage/backend/app/sample_reset.py"
test -s "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/downloads/relay-client-scope.apk"
changed=1
cp -a "$stage/backend/app/." backend/app/
dc build api
fingerprint() { dc run --rm --no-deps -T api python -c 'from app.sample_reset import preservation_fingerprint; print(preservation_fingerprint())' | tail -n 1; }
before="$(fingerprint)"
dc run --rm --no-deps -T -e RELAY_RESET_OPERATIONAL_SAMPLES=KEEP_ACCOUNTS_AND_PLANS api python -m app.sample_reset
after="$(fingerprint)"
test "$before" = "$after"
printf '%s\n' "$after" > "$backup/preserved-accounts-plans.sha256"
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 009
cp -a "$stage/web/dist/." web/dist/
install -D -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 10 "$base/api/health" >/dev/null
curl -fsS --max-time 10 "$base/mobile-demo/" >/dev/null
trap - ERR
echo "Client review/sample release complete; backup=$backup; accounts/plans/sessions unchanged"
