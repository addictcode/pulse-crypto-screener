#!/usr/bin/env bash
# Dumps the Pulse database of the stack in this checkout and keeps the last two weeks of dumps.
# On the server it runs every night (cron, set up by deploy/oracle/setup.sh) and before every
# deploy, because a deploy may carry a migration.
#   deploy/backup.sh [label]       e.g. deploy/backup.sh pre-deploy
# PULSE_BACKUP_DIR (default ~/backups) and PULSE_BACKUP_DAYS (default 14) change where and how long.
set -euo pipefail
cd "$(dirname "$0")/.."

dir=${PULSE_BACKUP_DIR:-$HOME/backups}
keep=${PULSE_BACKUP_DAYS:-14}
# the server's stack by default; the Mac's names its own project and files in COMPOSE_PROJECT_NAME
# and COMPOSE_FILE (deploy/home.sh deploy does)
compose() {
  if [ -n "${COMPOSE_FILE:-}" ]; then
    docker compose "$@"
  else
    docker compose -f compose.prod.yaml "$@"
  fi
}

if [ -z "$(compose ps -q postgres 2>/dev/null)" ]; then
  # before the first start there is nothing to keep, and a deploy must not stop on that
  echo "postgres is not running, nothing to back up"
  exit 0
fi

mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/pulse-$(date -u +%Y%m%d-%H%M%S)${1:+-$1}.dump"
trap 'rm -f "$file.part"' EXIT
compose exec -T postgres pg_dump -U pulse -d pulse -Fc > "$file.part"

# a dump that lists no table data is not a backup, whatever its size
tables=$(compose exec -T postgres pg_restore -l < "$file.part" | grep -c 'TABLE DATA' || true)
if [ "$tables" -eq 0 ]; then
  echo "the dump has no table data, not kept" >&2
  exit 1
fi
mv "$file.part" "$file"
find "$dir" -name 'pulse-*.dump' -mtime +"$keep" -delete
echo "$file: $(du -h "$file" | cut -f1), $tables tables"
