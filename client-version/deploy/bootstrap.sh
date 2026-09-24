#!/usr/bin/env bash
set -euo pipefail
cd /opt/relay-client
test "$(pwd -P)" = /opt/relay-client
test -s .env
chmod 600 .env
mkdir -p acme downloads backups
chmod 700 backups
find web -type d -exec chmod 755 {} +
find web -type f -exec chmod 644 {} +
docker compose --env-file .env -f deploy/compose.yaml --project-directory . build api
docker compose --env-file .env -f deploy/compose.yaml --project-directory . up -d db
docker compose --env-file .env -f deploy/compose.yaml --project-directory . run --rm api python -m alembic upgrade head
docker compose --env-file .env -f deploy/compose.yaml --project-directory . run --rm api python -m app.seed
docker compose --env-file .env -f deploy/compose.yaml --project-directory . up -d api
for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8119/api/health; then break; fi
    sleep 2
done
curl -fsS http://127.0.0.1:8119/api/health
# A unique site file; never overwrite another application's configuration.
test ! -e /etc/nginx/sites-available/relay-client
test ! -e /etc/nginx/sites-enabled/relay-client
cp deploy/nginx-http.conf /etc/nginx/sites-available/relay-client
ln -s /etc/nginx/sites-available/relay-client /etc/nginx/sites-enabled/relay-client
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /opt/relay-client/acme -d relay-client.187-127-162-233.sslip.io --non-interactive --keep-until-expiring
cp deploy/nginx.conf /etc/nginx/sites-available/relay-client
nginx -t
systemctl reload nginx
curl -fsS https://relay-client.187-127-162-233.sslip.io/api/health
