$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "backups" | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = "backups/moveintrack_$stamp.sql"
docker compose exec -T db pg_dump -U moveintrack -d moveintrack | Out-File -Encoding utf8 $file
Get-ChildItem backups -Filter "moveintrack_*.sql" | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item
Write-Host "Backup created: $file"
