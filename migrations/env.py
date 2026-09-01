from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.db import Base
from app import models  # noqa: F401

config = context.config

# 1. إحضار رابط الداتا بيز من البيئة أو استخدام رابط Neon أونلاين مباشرة
db_url = settings.database_url

# 2. التأكد من تحويل postgresql:// أو postgres:// إلى postgresql+psycopg:// ليتوافق مع SQLAlchemy 2.0 / psycopg3
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+psycopg://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

# إذا كان الرابط لا يزال يشير لـ SQLite، يتم استبداله برابط Neon أونلاين
if "sqlite" in db_url:
    db_url = "postgresql+psycopg://neondb_owner:npg_gZ0wJiyMb2Fo@ep-purple-scene-aeu9kd01-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

config.set_main_option("sqlalchemy.url", db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # استخدام db_url المباشر لإنشاء الاتصال بالسيرفر أونلاين
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = db_url
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()