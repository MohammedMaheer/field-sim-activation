#!/usr/bin/env bash
# Client-only static update for the proposal edition. No API or database changes.
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected static release archive}"
case "$archive" in /opt/relay-client/backups/plan-assets-*.tar.gz) test -s "$archive" ;; *) echo 'Expected a plan-assets archive under client backups' >&2; exit 2 ;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/plan-assets-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/plan-assets-stage.XXXXXX)"
mkdir -m 700 "$backup"
tar -czf "$backup/static.tar.gz" web/dist downloads/relay-client-scope.apk
chmod 600 "$backup/static.tar.gz"
tar -xzf "$archive" -C "$stage"
test -s "$stage/web/dist/index.html"
test -s "$stage/web/dist/mobile-demo/index.html"
test -s "$stage/downloads/relay-client-scope.apk"
changed=0
rollback() {
  code=$?
  trap - ERR
  if [ "$changed" = 1 ]; then tar -xzf "$backup/static.tar.gz" -C /opt/relay-client; echo "Static update rolled back; backup=$backup" >&2; fi
  exit "$code"
}
trap rollback ERR
changed=1
cp -a "$stage/web/dist/." web/dist/
install -D -m 644 "$stage/downloads/relay-client-scope.apk" downloads/relay-client-scope.apk
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/ >/dev/null
curl -fsS --max-time 10 https://relay-client.187-127-162-233.sslip.io/mobile-demo/ >/dev/null
curl -fsS --max-time 10 -o /dev/null https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk
trap - ERR
echo "Client static update complete; backup=$backup"