from __future__ import annotations

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

# قراءة المتغير من بيئة السيرفر مباشرة
db_url = os.getenv("DATABASE_URL")

# لو Railway مبعتش المتغير أو قرا قيمة فاضية، نضمن إنه ميروحش لـ sqlite
if not db_url or "sqlite" in db_url:
    # هتحط رابط Neon كـ Fallback مباشر عشان نخلص من المشكلة دي فوراً
    db_url = "postgresql+psycopg://neondb_owner:npg_gZ0wJiyMb2Fo@ep-purple-scene-aeu9kd01-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"

# تحويل postgres:// إلى postgresql+psycopg:// لضمان التوافق
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

connect_args: dict[str, object] = {}

engine = create_engine(
    db_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_timeout=60,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()