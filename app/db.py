from __future__ import annotations

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

# قراءة مباشرة وحاسمة من Environment Variables
raw_url = os.environ.get("DATABASE_URL", "sqlite:///./moveintrack.db")

# تحويل postgres:// إلى postgresql+psycopg://
if raw_url.startswith("postgres://"):
    raw_url = raw_url.replace("postgres://", "postgresql+psycopg://", 1)

connect_args: dict[str, object] = {}
if raw_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    raw_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_timeout=60,
    future=True,
)

if raw_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()