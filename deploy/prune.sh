#!/usr/bin/env bash
# Keeps the signal table from growing without end: the long text of old signals (detail, ~200
# bytes a row) is emptied after PULSE_DETAIL_DAYS (default 180). Type, pair, time, price, value,
# direction and outcomes stay forever: they are the record and the research. Dumps first, as
# every deletion from the live database must (CLAUDE.md); stops if the dump fails.
#   deploy/prune.sh
# Same compose settings as deploy/backup.sh (COMPOSE_PROJECT_NAME, COMPOSE_FILE on the Mac).
set -euo pipefail
cd "$(dirname "$0")/.."

days=${PULSE_DETAIL_DAYS:-180}
compose() {
  if [ -n "${COMPOSE_FILE:-}" ]; then
    docker compose "$@"
  else
    docker compose -f compose.prod.yaml "$@"
  fi
}

deploy/backup.sh pre-prune
compose exec -T postgres psql -U pulse -d pulse -v ON_ERROR_STOP=1 <<SQL
update signal set detail = '' where fired_at < now() - interval '$days days' and detail <> '';
vacuum (analyze) signal;
select count(*) as signals, pg_size_pretty(pg_total_relation_size('signal')) as size from signal;
SQL
