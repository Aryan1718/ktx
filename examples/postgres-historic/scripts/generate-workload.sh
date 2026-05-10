#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$EXAMPLE_DIR/docker-compose.yml"
MODE="${1:-base}"

run_sql() {
  local user="$1"
  local password="$2"
  local sql="$3"
  docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$password" postgres \
    psql -h 127.0.0.1 -U "$user" -d analytics -v ON_ERROR_STOP=1 -c "$sql" >/dev/null
}

for _ in $(seq 1 12); do
  run_sql app_user app_pass "SELECT c.region, count(*) AS order_count FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'paid' GROUP BY c.region ORDER BY c.region"
done

for _ in $(seq 1 7); do
  run_sql app_user app_pass "SELECT c.plan, sum(o.total) AS revenue FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.created_at >= now() - interval '14 days' GROUP BY c.plan ORDER BY revenue DESC"
done

for _ in $(seq 1 5); do
  run_sql etl_user etl_pass "SELECT e.event_name, count(*) AS event_count FROM events e JOIN customers c ON c.id = e.customer_id WHERE c.region = 'na' GROUP BY e.event_name ORDER BY event_count DESC"
done

if [[ "$MODE" == "extra" ]]; then
  for _ in $(seq 1 4); do
    run_sql etl_user etl_pass "SELECT c.region, avg(o.total) AS avg_total FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status <> 'refunded' GROUP BY c.region ORDER BY avg_total DESC"
  done
fi
