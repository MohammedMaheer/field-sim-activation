#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected mobile release archive}"
case "$archive" in /opt/relay-client/backups/operations-mobile-*.tar.gz) test -s "$archive";; *) exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/operations-mobile-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/operations-mobile-stage.XXXXXX)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
test -s "$stage/mobile-demo/index.html"
test -s "$stage/mobile-demo/main.dart.js"
test -s "$stage/relay-client-scope.apk"
tar -czf "$backup/files.tar.gz" web/dist/mobile-demo downloads/relay-client-scope.apk
chmod 600 "$backup/files.tar.gz"
rollback() {
  code=$?
  trap - ERR
  tar -xzf "$backup/files.tar.gz" -C /opt/relay-client
  echo "Mobile release rolled back; backup=$backup" >&2
  exit "$code"
}
trap rollback ERR
cp -a "$stage/mobile-demo/." web/dist/mobile-demo/
install -m 644 "$stage/relay-client-scope.apk" downloads/relay-client-scope.apk
base=https://relay-client.187-127-162-233.sslip.io
curl -fsS --max-time 15 "$base/mobile-demo/" >/dev/null
curl -fsS --max-time 15 "$base/mobile-demo/main.dart.js" >/dev/null
curl -fsSI --max-time 15 "$base/downloads/relay-client-scope.apk" >/dev/null
trap - ERR
echo "Mobile release complete; backup=$backup"
