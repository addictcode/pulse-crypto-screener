#!/usr/bin/env bash
# A backup nobody restored is not a backup. Restores the newest dump (or the one given) into a
# throwaway PostgreSQL container and holds the row count of every table against the counts
# deploy/backup.sh wrote next to it just before dumping. Nothing touches the live database.
#   deploy/restore-check.sh [file.dump]
# PULSE_BACKUP_DIR (default ~/backups) is where the dumps are. Exit status 1 when a table is
# missing or short; the server runs it weekly (cron, deploy/oracle/setup.sh), the Mac with
# deploy/home.sh check.
set -euo pipefail

dir=${PULSE_BACKUP_DIR:-$HOME/backups}
dump=${1:-$(ls -t "$dir"/pulse-*.dump 2>/dev/null | head -1 || true)}
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "no dump found in $dir" >&2
  exit 1
fi
counts="$dump.counts"
name=pulse-restore-check-$$
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

echo "restoring $dump ($(du -h "$dump" | cut -f1)) into a throwaway container"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=check -e POSTGRES_USER=pulse -e POSTGRES_DB=pulse postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U pulse -d pulse -q 2>/dev/null && break
  sleep 1
done
# the image's init restarts the server once; wait for the real one
sleep 2
for _ in $(seq 1 30); do
  docker exec "$name" psql -U pulse -d pulse -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$name" pg_restore -U pulse -d pulse --no-owner --no-privileges --exit-on-error < "$dump"

restored() {
  docker exec "$name" psql -U pulse -d pulse -At -c "select count(*) from \"$1\"" 2>/dev/null || echo missing
}

failed=0
if [ -f "$counts" ]; then
  printf '%-28s %12s %12s\n' table "at dump" restored
  while read -r table expected; do
    [ -n "$table" ] || continue
    got=$(restored "$table")
    mark=ok
    # rows written while pg_dump ran may be in the dump too, never fewer
    if [ "$got" = missing ] || [ "$got" -lt "$expected" ]; then
      mark=SHORT
      failed=1
    fi
    printf '%-28s %12s %12s  %s\n' "$table" "$expected" "$got" "$mark"
  done < "$counts"
else
  echo "no $counts (a dump from before counts were kept): checking that the main tables came back"
  for table in signal app_user databasechangelog; do
    got=$(restored "$table")
    echo "$table: $got"
    [ "$got" = missing ] && failed=1
  done
fi

if [ "$failed" -ne 0 ]; then
  echo "RESTORE CHECK FAILED: $dump does not restore what it should" >&2
  exit 1
fi
echo "restore check passed: $dump"
