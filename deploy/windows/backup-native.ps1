param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$BackupPath = "D:\MoveintrackBackups",
  [int]$RetentionDays = 30
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $BackupPath | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$file = Join-Path $BackupPath "moveintrack_$stamp.backup"
& "$PgBin\pg_dump.exe" -h 127.0.0.1 -U moveintrack -d moveintrack -F c -f $file
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Get-ChildItem $BackupPath -Filter "moveintrack_*.backup" | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays)} | Remove-Item
Write-Host "Backup created: $file"
