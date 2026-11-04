#!/usr/bin/env bash
# Brings the stack on the server to the version checked out here. Run from /opt/pulse after
# `git pull` (the CI deploy and deploy/deploy.sh do both):
#   deploy/update.sh
#
# With PULSE_BACKEND_IMAGE and PULSE_WEB_IMAGE in .env (ghcr.io/<owner>/pulse-backend and
# .../pulse-web) it pulls the images CI built for exactly this commit instead of building Java on
# the server's two cores. An image that is not there (CI still running, or the build failed) is
# built here instead, so the server never runs an older image under a newer checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

compose() {
  docker compose -f compose.prod.yaml "$@"
}
setting() {
  { sed -n "s/^$1=//p" .env 2>/dev/null || true; } | tail -1
}

# a deploy may carry a migration: the database is dumped first, and without a dump nothing goes on
deploy/backup.sh pre-deploy

backend_image=$(setting PULSE_BACKEND_IMAGE)
web_image=$(setting PULSE_WEB_IMAGE)
if [ -n "$backend_image" ] && [ -n "$web_image" ]; then
  PULSE_IMAGE_TAG=$(git rev-parse HEAD)
  export PULSE_IMAGE_TAG
  if compose pull backend web; then
    echo "images of $PULSE_IMAGE_TAG pulled"
    compose up -d --no-build --remove-orphans
  else
    echo "no ready images for $PULSE_IMAGE_TAG, building them here"
    compose up -d --build --remove-orphans
  fi
  # plain `docker compose` commands afterwards (no tag given) mean this same version
  docker tag "$backend_image:$PULSE_IMAGE_TAG" "$backend_image:latest"
  docker tag "$web_image:$PULSE_IMAGE_TAG" "$web_image:latest"
  # earlier versions are not dangling, so prune would keep them all; the registry still has them
  for image in "$backend_image" "$web_image"; do
    old=$(docker images "$image" --format '{{.Tag}}' | grep -vxE "latest|$PULSE_IMAGE_TAG" || true)
    for tag in $old; do
      docker rmi "$image:$tag" > /dev/null || true
    done
  done
else
  compose up -d --build --remove-orphans
fi
docker image prune -f > /dev/null
compose ps
