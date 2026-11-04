#!/usr/bin/env bash
# Deploys the current main to the server: pull, then deploy/update.sh there (dump the database,
# take CI's ready images or build, restart).
#   deploy/deploy.sh pulse@HOST
set -euo pipefail

TARGET=${1:?usage: deploy/deploy.sh pulse@HOST}

ssh "$TARGET" 'set -euo pipefail
  cd /opt/pulse
  git pull --ff-only
  deploy/update.sh'
