from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import struct
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import SessionToken, SystemSetting, User

SESSION_COOKIE = "mit_session"


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": {"*"},
    "control": {
        "journey:view", "journey:edit", "journey:transition", "journey:checkin",
        "vehicle:view", "driver:view", "report:view", "notification:view",
    },
    "approver": {
        "journey:view", "journey:approve", "vehicle:view", "driver:view",
        "report:view", "notification:view",
    },
    "hse": {
        "journey:view", "journey:approve", "vehicle:view", "driver:view",
        "report:view", "notification:view",
    },
    "creator": {
        "journey:view", "journey:create", "journey:edit", "vehicle:view",
        "driver:view", "notification:view",
    },
    "viewer": {"journey:view", "vehicle:view", "driver:view", "report:view", "notification:view"},
}


def generate_mfa_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _decode_mfa_secret(secret: str) -> bytes:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    return base64.b32decode(padded, casefold=True)


def totp_code(secret: str, at_time: int | None = None) -> str:
    counter = int((at_time if at_time is not None else time.time()) // 30)
    digest = hmac.new(_decode_mfa_secret(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{number:06d}"


def verify_totp(secret: str, code: str) -> bool:
    normalized = re.sub(r"\s+", "", code or "")
    if not re.fullmatch(r"\d{6}", normalized):
        return False
    now = int(time.time())
    return any(hmac.compare_digest(totp_code(secret, now + offset * 30), normalized) for offset in (-1, 0, 1))


def generate_recovery_codes(count: int = 10) -> list[str]:
    return [f"{secrets.token_hex(3).upper()}-{secrets.token_hex(3).upper()}" for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", code).upper()
    return hashlib.sha256(normalized.encode()).hexdigest()


def verify_mfa_or_recovery(user: User, code: str) -> tuple[bool, bool]:
    if user.mfa_secret and verify_totp(user.mfa_secret, code):
        return True, False
    candidate = hash_recovery_code(code)
    try:
        hashes = json.loads(user.mfa_recovery_hashes or "[]")
    except json.JSONDecodeError:
        hashes = []
    for stored in list(hashes):
        if hmac.compare_digest(stored, candidate):
            hashes.remove(stored)
            user.mfa_recovery_hashes = json.dumps(hashes)
            return True, True
    return False, False


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    n, r, p = 2**14, 8, 1
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_hex, hash_hex = stored.split("$", 5)
        if algo != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n), r=int(r), p=int(p), dklen=32,
        )
        return hmac.compare_digest(derived.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def validate_password(password: str) -> list[str]:
    errors: list[str] = []
    if len(password) < 12:
        errors.append("Password must contain at least 12 characters.")
    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain an uppercase letter.")
    if not re.search(r"[a-z]", password):
        errors.append("Password must contain a lowercase letter.")
    if not re.search(r"\d", password):
        errors.append("Password must contain a number.")
    if not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Password must contain a special character.")
    return errors


def create_session(db: Session, user: User, request: Request) -> tuple[str, str, datetime]:
    raw_token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(hours=settings.session_hours)
    ip = client_ip(request)
    session = SessionToken(
        token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
        csrf_token=csrf,
        user_id=user.id,
        expires_at=expires,
        ip_address=ip,
        user_agent=request.headers.get("user-agent", "")[:500],
    )
    db.add(session)
    db.commit()
    return raw_token, csrf, expires


def revoke_session(db: Session, raw_token: str | None) -> None:
    if not raw_token:
        return
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    db.execute(delete(SessionToken).where(SessionToken.token_hash == token_hash))
    db.commit()


def client_ip(request: Request) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:80]
    return (request.client.host if request.client else "")[:80]


def get_current_session(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    session_cookie: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> SessionToken:
    if not session_cookie:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    token_hash = hashlib.sha256(session_cookie.encode()).hexdigest()
    session = db.scalar(
        select(SessionToken).where(
            SessionToken.token_hash == token_hash,
            SessionToken.expires_at > utcnow(),
        )
    )
    if not session or not session.user or not session.user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid.")
    allowed_password_paths = {"/api/auth/change-password", "/api/auth/logout", "/api/auth/mfa/setup", "/api/auth/mfa/confirm", "/api/auth/mfa/disable"}
    if session.user.must_change_password and request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path not in allowed_password_paths:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password change is required before performing operational actions.")
    mfa_row = db.get(SystemSetting, "require_mfa")
    try:
        mfa_required = bool(json.loads(mfa_row.value)) if mfa_row else False
    except (json.JSONDecodeError, TypeError):
        mfa_required = False
    if mfa_required and not session.user.mfa_enabled and request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path not in allowed_password_paths:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Multi-factor authentication setup is required before operational actions.")
    request.state.session = session
    request.state.user = session.user
    return session


def get_current_user(session: Annotated[SessionToken, Depends(get_current_session)]) -> User:
    return session.user


def require_permission(permission: str):
    def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        allowed = ROLE_PERMISSIONS.get(user.role, set())
        if "*" not in allowed and permission not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission for this action.")
        return user
    return dependency


def verify_csrf(
    request: Request,
    session: Annotated[SessionToken, Depends(get_current_session)],
    csrf_header: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if not csrf_header or not hmac.compare_digest(csrf_header, session.csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed. Refresh and try again.")
