@echo off
set ENVIRONMENT=development
set DATABASE_URL=sqlite:///./moveintrack.db
set COOKIE_SECURE=false
set ALLOWED_HOSTS=localhost,127.0.0.1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
