#!/usr/bin/env bash
# Runs Pulse on this machine behind a Cloudflare quick tunnel and prints the public address.
#   deploy/home.sh          start or update, then show the address
#   deploy/home.sh url      only show the current address
#   deploy/home.sh stop     stop everything (data stays in Docker volumes)
set -euo pipefail
cd "$(dirname "$0")/.."

compose() {
  docker compose -p pulse -f compose.prod.yaml -f compose.tunnel.yaml "$@"
}

url() {
  for _ in $(seq 1 30); do
    found=$(compose logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
    if [ -n "$found" ]; then
      echo "$found"
      return
    fi
    sleep 2
  done
  echo "tunnel address not found yet; check: docker compose -p pulse logs tunnel" >&2
  return 1
}

case "${1:-up}" in
  url) url ;;
  stop) compose down ;;
  up)
    if [ ! -f .env ]; then
      cat > .env <<ENV
# home hosting through a Cloudflare quick tunnel (see deploy/home.sh)
PULSE_DOMAIN=localhost
PULSE_SITE_ADDRESS=:80
PULSE_HTTP_PORT=8088
PULSE_HTTPS_PORT=8443
# the tunnel address changes on restart, so accept any trycloudflare.com origin
PULSE_PUBLIC_ORIGIN=https://*.trycloudflare.com,http://localhost:8088
POSTGRES_PASSWORD=$(openssl rand -hex 24)
PULSE_TELEGRAM_ENABLED=false
PULSE_TELEGRAM_TOKEN=
PULSE_TELEGRAM_OWNER_CHAT_ID=
ENV
      chmod 600 .env
      echo "created .env"
    fi
    compose up -d --build --remove-orphans
    echo "Pulse is at: $(url)"
    ;;
  *) echo "usage: deploy/home.sh [up|url|stop]" >&2; exit 2 ;;
esac
