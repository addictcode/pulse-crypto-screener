#!/usr/bin/env bash
# Pings the healthchecks.io check in PULSE_HEARTBEAT_URL (.env) while the public site answers with
# Pulse's own API. The alarm is the missing ping, so it covers everything at once: the server
# down, the stack stopped, the certificate or DNS broken. Every minute from cron on the server.
set -euo pipefail
cd "$(dirname "$0")/.."

url=$(sed -n 's/^PULSE_HEARTBEAT_URL=//p' .env 2>/dev/null || true)
domain=$(sed -n 's/^PULSE_DOMAIN=//p' .env 2>/dev/null || true)
[ -n "$url" ] && [ -n "$domain" ] || exit 0
curl -fsS -m 10 -o /dev/null "https://$domain/api/status" && curl -fsS -m 10 -o /dev/null "$url"
