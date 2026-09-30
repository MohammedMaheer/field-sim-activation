#!/usr/bin/env bash
# Replace only the shared phone demo and APK after the tested sign-out correction.
set -Eeuo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
archive="${1:?Expected phone follow-up archive}"
case "$archive" in /opt/relay-client/backups/modern-trade-mobile-*.tar.gz) test -s "$archive";; *) exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/relay-client/backups/modern-trade-mobile-before-$stamp"
stage="$(mktemp -d /opt/relay-client/backups/modern-trade-mobile-stage.XXXXXX)"
mkdir -m 700 "$backup"
tar -xzf "$archive" -C "$stage"
for file in mobile-demo/index.html mobile-demo/main.dart.js mobile-demo/flutter_bootstrap.js relay-client-scope.apk; do test -s "$stage/$file"; done
grep -q 'flutter-host' "$stage/mobile-demo/flutter_bootstrap.js"
! grep -q '{{flutter_js}}' "$stage/mobile-demo/flutter_bootstrap.js"
cp -a web/dist/mobile-demo "$backup/mobile-demo"
cp -a downloads/relay-client-scope.apk "$backup/relay-client-scope.apk"
changed=0
rollback() {
 code=$?; trap - ERR
 if [ "$changed" = 1 ]; then
  if [ -e web/dist/mobile-demo ]; then mv web/dist/mobile-demo "$backup/failed-mobile-demo"; fi
  cp -a "$backup/mobile-demo" web/dist/mobile-demo
  cp -a "$backup/relay-client-scope.apk" downloads/relay-client-scope.apk
 fi
 exit "$code"
}
trap rollback ERR
next="/opt/relay-client/web/dist/mobile-next-$stamp"
test ! -e "$next"
cp -a "$stage/mobile-demo" "$next"
changed=1
mv web/dist/mobile-demo "$backup/prior-mobile-demo"
mv "$next" web/dist/mobile-demo
install -m 644 "$stage/relay-client-scope.apk" downloads/relay-client-scope.apk
curl -fsS --max-time 15 https://relay-client.187-127-162-233.sslip.io/mobile-demo/ >/dev/null
curl -fsSI --max-time 15 https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk >/dev/null
sha256sum downloads/relay-client-scope.apk
trap - ERR
echo "Phone sign-out follow-up complete; backup=$backup"
