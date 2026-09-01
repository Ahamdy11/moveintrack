from __future__ import annotations

import os


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    @property
    def app_name(self) -> str:
        return os.getenv("APP_NAME", "Moveintrack")

    @property
    def environment(self) -> str:
        return os.getenv("ENVIRONMENT", "development")

    @property
    def app_version(self) -> str:
        return os.getenv("APP_VERSION", "1.0.0")

    @property
    def database_url(self) -> str:
        url = os.getenv("DATABASE_URL", "sqlite:///./moveintrack.db")
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        return url

    @property
    def session_hours(self) -> int:
        return int(os.getenv("SESSION_HOURS", "12"))

    @property
    def cookie_secure(self) -> bool:
        return _bool("COOKIE_SECURE", False)

    @property
    def trust_proxy(self) -> bool:
        return _bool("TRUST_PROXY", False)

    @property
    def allowed_hosts(self) -> tuple[str, ...]:
        raw = os.getenv("ALLOWED_HOSTS", "*")
        return tuple(host.strip() for host in raw.split(",") if host.strip())

    @property
    def initial_admin_email(self) -> str:
        return os.getenv("INITIAL_ADMIN_EMAIL", "admin@moveintrack.app").lower()

    @property
    def initial_admin_password(self) -> str:
        return os.getenv("INITIAL_ADMIN_PASSWORD", "ChangeMe!2026")

    @property
    def initial_admin_name(self) -> str:
        return os.getenv("INITIAL_ADMIN_NAME", "Moveintrack Administrator")


settings = Settings()