#!/usr/bin/env bash
set -euo pipefail
cd /opt/relay-client
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file .env -f deploy/compose.yaml --project-directory . exec -T db pg_dump -U relay -d relay -Fc > "backups/relay-$stamp.dump"
test -s "backups/relay-$stamp.dump"
docker compose --env-file .env -f deploy/compose.yaml --project-directory . exec -T db pg_restore --list < "backups/relay-$stamp.dump" > "backups/relay-$stamp.manifest"
echo "Relay backup created and archive catalog verified: backups/relay-$stamp.dump"
