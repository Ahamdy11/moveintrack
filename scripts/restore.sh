#!/usr/bin/env sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/restore.sh backups/moveintrack_YYYYMMDD_HHMMSS.sql.gz"
  exit 1
fi
echo "WARNING: This replaces the current Moveintrack database. Press Ctrl+C to cancel."
sleep 8
docker compose stop app
docker compose exec -T db psql -U moveintrack -d postgres -c "DROP DATABASE IF EXISTS moveintrack WITH (FORCE);"
docker compose exec -T db psql -U moveintrack -d postgres -c "CREATE DATABASE moveintrack OWNER moveintrack;"
gzip -dc "$1" | docker compose exec -T db psql -U moveintrack -d moveintrack
docker compose start app
echo "Restore completed."
