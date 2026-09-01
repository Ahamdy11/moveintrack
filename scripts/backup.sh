#!/usr/bin/env sh
set -eu
mkdir -p backups
STAMP=$(date +%Y%m%d_%H%M%S)
docker compose exec -T db pg_dump -U moveintrack -d moveintrack | gzip > "backups/moveintrack_${STAMP}.sql.gz"
find backups -type f -name 'moveintrack_*.sql.gz' -mtime +30 -delete
printf 'Backup created: backups/moveintrack_%s.sql.gz\n' "$STAMP"
