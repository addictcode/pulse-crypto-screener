#!/usr/bin/env bash
# Starts the production stack on a made-up market and runs a k6 scenario against it, sampling the
# containers' CPU and memory meanwhile. Results land in loadtest/results/<scenario>-<time>/.
#   loadtest/run.sh visitors [k6 -e options...]     e.g. loadtest/run.sh visitors -e VUS=300
#   loadtest/run.sh burst
#   loadtest/run.sh up                              start the stack and wait for it, no k6
#                                                   (the stack walk in web/e2e-stack uses it)
#   loadtest/run.sh down                            stop the stack and drop its data
# --local-build (first argument) builds the jar and the site outside Docker, for networks where the
# Dockerfiles cannot download their dependencies.
set -euo pipefail

cd "$(dirname "$0")/.."
project=pulse-load
files=(-f compose.prod.yaml -f loadtest/compose.loadtest.yaml)
if [ "${1:-}" = --local-build ]; then
  shift
  (cd backend && ./gradlew --quiet bootJar)
  (cd web && npm run --silent build)
  rm -rf loadtest/.build && mkdir -p loadtest/.build/backend loadtest/.build/web
  cp backend/build/libs/pulse-backend.jar loadtest/.build/backend/
  cp -r web/dist web/Caddyfile loadtest/.build/web/
fi
# once built that way, later runs reuse it
if [ -d loadtest/.build ]; then
  files+=(-f loadtest/compose.local-build.yaml)
fi
compose() { docker compose -p "$project" "${files[@]}" --env-file loadtest/loadtest.env "$@"; }

scenario=${1:?usage: loadtest/run.sh [--local-build] visitors|burst|up|down [k6 options]}
shift
if [ "$scenario" = down ]; then
  compose down -v
  exit 0
fi

compose up -d --build
echo "waiting for the backend to be healthy"
for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$project-backend-1" 2>/dev/null)" = healthy ] && break
  sleep 2
done
if [ "$scenario" = up ]; then
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$project-backend-1")" = healthy ] || {
    compose logs --no-color --tail 100 backend
    echo "the backend did not become healthy" >&2
    exit 1
  }
  echo "up on http://localhost:8088"
  exit 0
fi
# the detectors wait two minutes after start; the stream does not
out=loadtest/results/$scenario-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$out"
# k6 runs as its own user inside the container and writes its summary here
chmod 777 "$out"

# CPU, memory and network of every container, every 5 seconds, while k6 runs
( while true; do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}}' | sed "s/^/$(date -u +%H:%M:%S),/"
    sleep 5
  done ) > "$out/stats.csv" &
sampler=$!
trap 'kill $sampler 2>/dev/null || true' EXIT

docker run --rm -i --network "${project}_default" -v "$PWD/loadtest:/t" grafana/k6:0.57.0 \
  run --summary-export "/t/${out#loadtest/}/summary.json" "$@" "/t/$scenario.js" 2>&1 | tee "$out/k6.txt" || true

kill $sampler 2>/dev/null || true
compose logs --no-color --since 15m backend > "$out/backend.log" 2>&1 || true
echo "results in $out"
