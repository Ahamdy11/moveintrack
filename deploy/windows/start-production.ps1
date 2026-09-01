param(
  [string]$AppPath = "C:\Moveintrack",
  [string]$EnvFile = "C:\Moveintrack\deploy\windows\.env.windows"
)
$ErrorActionPreference = "Stop"
Set-Location $AppPath
if (!(Test-Path $EnvFile)) { throw "Environment file not found: $EnvFile" }
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (!$line -or $line.StartsWith("#")) { return }
  $parts = $line.Split("=",2)
  if ($parts.Count -eq 2) { [Environment]::SetEnvironmentVariable($parts[0],$parts[1],"Process") }
}
& "$AppPath\.venv\Scripts\python.exe" -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw "Database migration failed" }
& "$AppPath\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips "127.0.0.1"
