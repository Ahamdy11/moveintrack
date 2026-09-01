$ErrorActionPreference = "Stop"
$env:ENVIRONMENT = "development"
$env:DATABASE_URL = "sqlite:///./moveintrack.db"
$env:COOKIE_SECURE = "false"
$env:ALLOWED_HOSTS = "localhost,127.0.0.1"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
