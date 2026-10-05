#!/usr/bin/env bash
# Deploys the current main to the server: pull, rebuild what changed, restart.
#   deploy/deploy.sh pulse@HOST
set -euo pipefail

TARGET=${1:?usage: deploy/deploy.sh pulse@HOST}

ssh "$TARGET" 'set -euo pipefail
  cd /opt/pulse
  git pull --ff-only
  docker compose -f compose.prod.yaml up -d --build --remove-orphans
  docker image prune -f > /dev/null
  docker compose -f compose.prod.yaml ps'
