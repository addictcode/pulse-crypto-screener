#!/usr/bin/env bash
# Deploys the current main to the server: pull, dump the database (the new version may migrate
# it), rebuild what changed, restart.
#   deploy/deploy.sh pulse@HOST
set -euo pipefail

TARGET=${1:?usage: deploy/deploy.sh pulse@HOST}

ssh "$TARGET" 'set -euo pipefail
  cd /opt/pulse
  git pull --ff-only
  deploy/backup.sh pre-deploy
  docker compose -f compose.prod.yaml up -d --build --remove-orphans
  docker image prune -f > /dev/null
  docker compose -f compose.prod.yaml ps'
