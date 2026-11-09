#!/usr/bin/env bash
# Runs the stack walk inside Playwright's own image, on the stack's Docker network: the same
# browser, fonts and libraries on a Mac, a cloud session and CI, so the screenshots of
# snapshots.e2e.ts match their references everywhere. Start the stack first:
#   loadtest/run.sh --local-build up
#   npm run stack                              (from web/)
#   npm run stack -- --update-snapshots        new references after a deliberate change of the look
#   npm run stack -- -g landing --project phone-390
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('@playwright/test/package.json').version")
network=${STACK_NETWORK:-pulse-load_default}
docker run --rm --init --ipc=host \
  --network "$network" \
  -e STACK_URL="${STACK_URL:-http://web}" -e CI="${CI:-}" -e HOME=/tmp \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/web" -w /web \
  "mcr.microsoft.com/playwright:v$version-noble" \
  npx playwright test -c e2e-stack "$@"
