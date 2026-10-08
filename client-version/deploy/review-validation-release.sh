#!/usr/bin/env bash
# Client-only review validation hotfix. No migrations or operational-record rewrite.
set -Eeuo pipefail
umask 077
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
test -s .env

archive="${1:?Expected captures-review-fix release archive}"
case "$archive" in /opt/relay-client/backups/captures-review-fix-*.tar.gz) ;; *) exit 2;; esac
test -f "$archive" && test -s "$archive" && test ! -L "$archive"
archive="$(realpath -e -- "$archive")"
test "$(dirname -- "$archive")" = /opt/relay-client/backups
case "$archive" in /opt/relay-client/backups/captures-review-fix-*.tar.gz) ;; *) exit 2;; esac

dc() { docker compose --env-file .env -f deploy/compose.yaml --project-directory . "$@"; }
revision() { dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 -c 'SELECT version_num FROM alembic_version'; }
test "$(revision)" = 015

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/captures-review-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/captures-review-stage.XXXXXX)"
qa_db="relay_review_restore_$(date -u +%Y%m%d%H%M%S)_$$"
old_image_tag="relay-client-api:pre-captures-review-$stamp"
changed=0
stopped=0
qa_created=0
mkdir -m 700 "$backup"

cleanup() {
  code=$?
  trap - EXIT
  set +e
  if [ "$qa_created" = 1 ]; then
    dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $qa_db"
  fi
  case "$stage" in /opt/relay-client/backups/captures-review-stage.*)
    test "$(dirname -- "$(realpath -e -- "$stage")")" = /opt/relay-client/backups && rm -rf -- "$stage"
    ;;
  esac
  exit "$code"
}
rollback() {
  code=$?
  trap - ERR
  set +e
  if [ "$changed" = 1 ]; then
    dc stop api
    tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
    docker image tag "$old_image_tag" relay-client-api:latest
    dc up -d --no-deps --force-recreate api
    echo "Review hotfix rolled back to the prior source and API image; backup=$backup" >&2
  elif [ "$stopped" = 1 ]; then
    dc up -d --no-deps api
  fi
  exit "$code"
}
trap cleanup EXIT
trap rollback ERR

# Validate before extraction: the package cannot replace any other client files.
python3 - "$archive" "$stage" <<'PY'
import pathlib
import sys
import tarfile

archive, stage = sys.argv[1:]
with tarfile.open(archive, "r:gz") as package:
    entries = package.getmembers()
    if len(entries) != 1 or entries[0].name != "backend/app/captures.py" or not entries[0].isfile():
        raise SystemExit("Release archive must contain only the regular file backend/app/captures.py")
    source = package.extractfile(entries[0])
    if source is None:
        raise SystemExit("Release source is missing")
    data = source.read()
    if not data:
        raise SystemExit("Release source is empty")
    compile(data, "backend/app/captures.py", "exec")
    target = pathlib.Path(stage) / entries[0].name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
PY

container="$(dc ps -q api)"
test -n "$container"
current_image="$(docker inspect --format '{{.Image}}' "$container")"
test -n "$current_image"
docker image tag "$current_image" "$old_image_tag"
printf '%s\n' "$current_image" "$old_image_tag" > "$backup/rollback-image.txt"
tar -czf "$backup/files.tar.gz" backend/app/captures.py .env
sha256sum backend/app/captures.py > "$backup/previous-source.sha256"
sha256sum .env web/dist/index.html web/dist/mobile-demo/index.html web/dist/mobile-demo/main.dart.js downloads/relay-client-scope.apk > "$backup/unchanged-files.sha256"
sha256sum "$archive" > "$backup/archive.sha256"

# Pause API writers so the restored snapshot can be compared with a stable live DB.
stopped=1
dc stop api
dc exec -T db pg_dump -U relay -d relay -Fc > "$backup/database.dump"
test -s "$backup/database.dump"
dc exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database.manifest"
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $qa_db"
qa_created=1
dc exec -T db pg_restore -U relay -d "$qa_db" --no-owner --exit-on-error < "$backup/database.dump"

cat > "$backup/state-check.sql" <<'SQL'
SELECT 'revision=' || version_num FROM alembic_version;
SELECT 'accounts=' || count(*) FROM users;
SELECT 'plans=' || count(*) FROM plans;
SELECT 'agents=' || count(*) FROM agents;
SELECT 'captures=' || count(*) FROM kyc_captures;
SELECT 'sales=' || count(*) FROM sales_records;
SELECT 'sims=' || count(*) FROM sim_inventory;
SELECT 'sim_progress=' || count(*) FROM sim_progress;
SELECT 'notifications=' || count(*) FROM notifications;
SELECT 'plans_hash=' || md5(coalesce(string_agg(row_to_json(p)::text, '' ORDER BY id), '')) FROM plans p;
SELECT 'accounts_hash=' || md5(coalesce(string_agg(row_to_json(u)::text, '' ORDER BY id), '')) FROM users u;
SELECT 'captures_hash=' || md5(coalesce(string_agg(md5(row_to_json(c)::text), '' ORDER BY id), '')) FROM kyc_captures c;
SELECT 'sales_hash=' || md5(coalesce(string_agg(md5(row_to_json(s)::text), '' ORDER BY id), '')) FROM sales_records s;
SELECT 'sims_hash=' || md5(coalesce(string_agg(md5(row_to_json(s)::text), '' ORDER BY id), '')) FROM sim_inventory s;
SELECT 'sim_progress_hash=' || md5(coalesce(string_agg(md5(row_to_json(s)::text), '' ORDER BY id), '')) FROM sim_progress s;
SELECT 'capture_status_' || status || '=' || count(*) FROM kyc_captures GROUP BY status ORDER BY status;
SELECT 'sale_status_' || status || '=' || count(*) FROM sales_records GROUP BY status ORDER BY status;
SELECT 'sim_status_' || status || '=' || count(*) FROM sim_inventory GROUP BY status ORDER BY status;
SELECT 'sim_stage_' || stage || '_payment_' || payment_status || '=' || count(*) FROM sim_progress GROUP BY stage, payment_status ORDER BY stage, payment_status;
SQL
dc exec -T db psql -U relay -d "$qa_db" -At -v ON_ERROR_STOP=1 < "$backup/state-check.sql" > "$backup/restored-state.txt"
grep -q '^revision=015$' "$backup/restored-state.txt"
dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 < "$backup/state-check.sql" > "$backup/live-state.txt"
diff -u "$backup/restored-state.txt" "$backup/live-state.txt"
dc exec -T db psql -U relay -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $qa_db"
qa_created=0

changed=1
install -m 644 "$stage/backend/app/captures.py" backend/app/captures.py
dc build api
sha256sum backend/app/captures.py > "$backup/released-source.sha256"
cmp "$stage/backend/app/captures.py" backend/app/captures.py
sha256sum -c "$backup/unchanged-files.sha256"
test "$(revision)" = 015
dc exec -T db psql -U relay -d relay -At -v ON_ERROR_STOP=1 < "$backup/state-check.sql" > "$backup/pre-start-state.txt"
diff -u "$backup/live-state.txt" "$backup/pre-start-state.txt"

# No migration command is invoked; only the client API is recreated.
dc up -d --no-deps --force-recreate api
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8119/api/health >/dev/null; then healthy=1; break; fi
  sleep 2
done
test "$healthy" = 1
test "$(revision)" = 015
curl -fsS --max-time 15 https://relay-client.187-127-162-233.sslip.io/api/health >/dev/null
sha256sum -c "$backup/unchanged-files.sha256"
trap - ERR
echo "Client review hotfix complete; restored backup and preserved records verified; backup=$backup"
