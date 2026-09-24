#!/bin/sh
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/relay-client.187-127-162-233.sslip.io ]; then
 nginx -t && systemctl reload nginx
fi
