from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Moveintrack")
    environment: str = os.getenv("ENVIRONMENT", "development")
    app_version: str = os.getenv("APP_VERSION", "1.0.0")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./moveintrack.db")
    session_hours: int = int(os.getenv("SESSION_HOURS", "12"))
    cookie_secure: bool = _bool("COOKIE_SECURE", False)
    trust_proxy: bool = _bool("TRUST_PROXY", False)
    allowed_hosts: tuple[str, ...] = tuple(
        host.strip() for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",") if host.strip()
    )
    initial_admin_email: str = os.getenv("INITIAL_ADMIN_EMAIL", "admin@moveintrack.app").lower()
    initial_admin_password: str = os.getenv("INITIAL_ADMIN_PASSWORD", "ChangeMe!2026")
    initial_admin_name: str = os.getenv("INITIAL_ADMIN_NAME", "Moveintrack Administrator")


settings = Settings()
