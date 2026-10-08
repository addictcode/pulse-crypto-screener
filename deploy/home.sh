#!/usr/bin/env bash
# Runs Pulse on this machine behind a Cloudflare quick tunnel and prints the public address.
#   deploy/home.sh           start or update, then show the address
#   deploy/home.sh url       only show the current address
#   deploy/home.sh publish   point the permanent link (GitHub Pages) at the current address
#   deploy/home.sh watch     keep it online: restart a dead tunnel and republish, until Ctrl+C
#   deploy/home.sh stop      stop everything (data stays in Docker volumes)
set -euo pipefail
cd "$(dirname "$0")/.."

# The quick tunnel gets a new random address every time it restarts. The permanent link is a
# GitHub Pages page (index.html in the repository root) that reads the current address from
# url.txt on this branch and forwards the visitor there.
LIVE_BRANCH=live

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

# True when the public address answers with Pulse's own API.
alive() {
  curl -fsS -m 10 -o /dev/null "$1/api/status" 2>/dev/null
}

publish() {
  local address=$1 repo sha
  if ! command -v gh >/dev/null || ! repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null); then
    echo "publish needs the GitHub CLI, signed in, inside the repository (gh auth login)" >&2
    return 1
  fi
  if ! gh api "repos/$repo/branches/$LIVE_BRANCH" >/dev/null 2>&1; then
    gh api -X POST "repos/$repo/git/refs" -f ref="refs/heads/$LIVE_BRANCH" -f sha="$(git rev-parse origin/main)" >/dev/null
  fi
  sha=$(gh api "repos/$repo/contents/url.txt?ref=$LIVE_BRANCH" -q .sha 2>/dev/null || true)
  gh api -X PUT "repos/$repo/contents/url.txt" \
    -f message="Pulse is at $address" \
    -f branch="$LIVE_BRANCH" \
    -f content="$(printf '%s' "$address" | base64)" \
    ${sha:+-f sha="$sha"} >/dev/null
  echo "published: https://${repo%%/*}.github.io/${repo##*/}/ now opens $address"
}

case "${1:-up}" in
  url) url ;;
  stop) compose down ;;
  publish) publish "$(url)" ;;
  watch)
    current=$(url)
    alive "$current" || { echo "$current does not answer yet, waiting"; sleep 20; }
    publish "$current"
    echo "watching $current (Ctrl+C to stop; run under 'caffeinate -is' so the Mac stays awake)"
    failures=0
    while sleep 60; do
      if alive "$current"; then
        failures=0
        continue
      fi
      failures=$((failures + 1))
      [ "$failures" -lt 3 ] && continue
      echo "$(date '+%H:%M:%S') $current stopped answering, restarting the tunnel"
      compose up -d --force-recreate tunnel >/dev/null 2>&1 || true
      sleep 10
      if next=$(url) && [ "$next" != "$current" ]; then
        current=$next
        publish "$current" || true
      fi
      failures=0
    done
    ;;
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
    address=$(url)
    # a tunnel that has been up for days may have lost its address on Cloudflare's side
    if ! alive "$address"; then
      sleep 15
      if ! alive "$address"; then
        compose up -d --force-recreate tunnel
        sleep 8
        address=$(url)
      fi
    fi
    echo "Pulse is at: $address"
    echo "Permanent link: deploy/home.sh publish (once), or deploy/home.sh watch to keep it current"
    ;;
  *) echo "usage: deploy/home.sh [up|url|publish|watch|stop]" >&2; exit 2 ;;
esac
