from __future__ import annotations

import asyncio
import csv
import io
import json
import secrets
import time
from urllib.parse import quote
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .models import Approval, AuditLog, Driver, Journey, JourneyEvent, Notification, SessionToken, User, Vehicle
from .schemas import (
    CheckinIn, DecisionIn, DriverIn, JourneyCreateIn, JourneyUpdateIn, LoginIn,
    MfaCodeIn, MfaDisableIn, PasswordChangeIn, PasswordResetIn, ReasonIn, SettingsIn, TransitionIn,
    UserCreateIn, UserUpdateIn, VehicleIn,
)
from .security import (
    ROLE_PERMISSIONS, SESSION_COOKIE, client_ip, create_session, generate_mfa_secret,
    generate_recovery_codes, get_current_session, get_current_user, hash_password,
    hash_recovery_code, require_permission, revoke_session, validate_password,
    verify_csrf, verify_mfa_or_recovery, verify_password, verify_totp,
)
from .services import (
    CHECKLIST_ITEMS, RISK_QUESTIONS, add_event, approve_journey, audit,
    calculate_risk, can_edit_journey, driver_dict, event_dict, get_settings,
    journey_dict, load_journey, notification_dict,
    process_overdue_checkins, record_checkin, reject_or_return, save_settings,
    submit_journey, transition_journey, user_dict, vehicle_dict,
)



def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

STATIC_DIR = Path(__file__).parent / "static"
LOGIN_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)


def _clean_old_attempts(ip: str) -> None:
    cutoff = time.time() - 900
    attempts = LOGIN_ATTEMPTS[ip]
    while attempts and attempts[0] < cutoff:
        attempts.popleft()


def _rate_limit_login(ip: str) -> None:
    _clean_old_attempts(ip)
    if len(LOGIN_ATTEMPTS[ip]) >= 12:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")


def _record_login_failure(ip: str) -> None:
    _clean_old_attempts(ip)
    LOGIN_ATTEMPTS[ip].append(time.time())


def _fail_user_login(db: Session, user: User | None, ip: str, now: datetime) -> None:
    _record_login_failure(ip)
    if user:
        user.failed_logins += 1
        if user.failed_logins >= 5:
            user.locked_until = now + timedelta(minutes=15)
            user.failed_logins = 0
        db.commit()


def _seed_database() -> None:
    if settings.environment != "production":
        Base.metadata.create_all(engine)
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.email == settings.initial_admin_email))
        if not admin:
            admin = User(
                email=settings.initial_admin_email,
                name=settings.initial_admin_name,
                title="System Administrator",
                division="All Divisions",
                role="admin",
                password_hash=hash_password(settings.initial_admin_password),
                active=True,
                must_change_password=True,
            )
            db.add(admin)
            db.commit()
        # Persist default settings on first run.
        current = get_settings(db)
        save_settings(db, SettingsIn(**current))


async def _overdue_worker() -> None:
    while True:
        try:
            with SessionLocal() as db:
                process_overdue_checkins(db)
                # Remove expired sessions once per cycle.
                expired = db.scalars(select(SessionToken).where(SessionToken.expires_at <= utcnow())).all()
                for item in expired:
                    db.delete(item)
                if expired:
                    db.commit()
        except Exception as exc:  # pragma: no cover - defensive production loop
            print(f"Moveintrack background worker error: {exc}")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _seed_database()
    task = asyncio.create_task(_overdue_worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Moveintrack API",
    version=settings.app_version,
    docs_url="/api/docs" if settings.environment != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=700)
if settings.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    try:
        content_length = int(request.headers.get("content-length", "0") or 0)
    except ValueError:
        content_length = 0
    if content_length > 2_000_000:
        return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "public, max-age=3600"
    return response


@app.exception_handler(IntegrityError)
async def integrity_handler(_request: Request, _exc: IntegrityError):
    return JSONResponse(status_code=409, content={"detail": "A record with the same unique value already exists."})


@app.get("/api/health")
def health(db: Annotated[Session, Depends(get_db)]):
    db.scalar(select(func.count()).select_from(User))
    return {"status": "healthy", "app": settings.app_name, "version": settings.app_version, "environment": settings.environment, "time": utcnow().isoformat() + "Z"}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, db: Annotated[Session, Depends(get_db)]):
    ip = client_ip(request)
    _rate_limit_login(ip)
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    now = utcnow()
    if not user or not user.active or (user.locked_until and user.locked_until > now) or not verify_password(payload.password, user.password_hash):
        _fail_user_login(db, user, ip, now)
        raise HTTPException(status_code=401, detail="Invalid credentials or temporarily locked account.")
    recovery_used = False
    if user.mfa_enabled:
        if not payload.otp:
            return JSONResponse(status_code=202, content={"mfa_required": True, "message": "Enter the authenticator or recovery code."})
        mfa_ok, recovery_used = verify_mfa_or_recovery(user, payload.otp)
        if not mfa_ok:
            _fail_user_login(db, user, ip, now)
            raise HTTPException(status_code=401, detail="Invalid multi-factor authentication code.")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    raw_token, csrf, expires = create_session(db, user, request)
    audit(db, user, "auth.login", "user", user.id, {"expires_at": expires.isoformat(), "mfa": user.mfa_enabled, "recovery_code_used": recovery_used}, ip)
    db.commit()
    response = JSONResponse({"user": user_dict(user), "csrf_token": csrf, "expires_at": expires.isoformat()})
    response.set_cookie(
        SESSION_COOKIE, raw_token, httponly=True, secure=settings.cookie_secure,
        samesite="strict", max_age=settings.session_hours * 3600, path="/",
    )
    return response


@app.post("/api/auth/logout", dependencies=[Depends(verify_csrf)])
def logout(request: Request, db: Annotated[Session, Depends(get_db)], session_cookie: str | None = None):
    raw = request.cookies.get(SESSION_COOKIE)
    user = getattr(request.state, "user", None)
    revoke_session(db, raw)
    if user:
        audit(db, user, "auth.logout", "user", user.id, ip=client_ip(request))
        db.commit()
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/api/auth/me")
def me(session=Depends(get_current_session)):
    return {"user": user_dict(session.user), "csrf_token": session.csrf_token, "expires_at": session.expires_at.isoformat()}


@app.post("/api/auth/change-password", dependencies=[Depends(verify_csrf)])
def change_password(payload: PasswordChangeIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=422, detail="Current password is incorrect.")
    errors = validate_password(payload.new_password)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Password does not meet policy.", "errors": errors})
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    current_session_id = getattr(getattr(request.state, "session", None), "id", None)
    other_sessions = db.scalars(select(SessionToken).where(SessionToken.user_id == user.id, SessionToken.id != current_session_id)).all()
    for other in other_sessions:
        db.delete(other)
    audit(db, user, "auth.password_changed", "user", user.id, {"other_sessions_revoked": len(other_sessions)}, client_ip(request))
    db.commit()
    return {"ok": True}


@app.post("/api/auth/mfa/setup", dependencies=[Depends(verify_csrf)])
def mfa_setup(request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    if user.must_change_password:
        raise HTTPException(status_code=409, detail="Change the temporary password before setting up MFA.")
    secret = generate_mfa_secret()
    user.mfa_pending_secret = secret
    issuer = quote(str(get_settings(db).get("workspace_name", "Moveintrack")))
    account = quote(user.email)
    uri = f"otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&digits=6&period=30"
    audit(db, user, "auth.mfa_setup_started", "user", user.id, ip=client_ip(request))
    db.commit()
    return {"secret": secret, "otpauth_uri": uri}


@app.post("/api/auth/mfa/confirm", dependencies=[Depends(verify_csrf)])
def mfa_confirm(payload: MfaCodeIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    if not user.mfa_pending_secret or not verify_totp(user.mfa_pending_secret, payload.code):
        raise HTTPException(status_code=422, detail="Invalid authenticator code.")
    recovery_codes = generate_recovery_codes()
    user.mfa_secret = user.mfa_pending_secret
    user.mfa_pending_secret = ""
    user.mfa_recovery_hashes = json.dumps([hash_recovery_code(code) for code in recovery_codes])
    user.mfa_enabled = True
    user.mfa_setup_at = utcnow()
    audit(db, user, "auth.mfa_enabled", "user", user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True, "recovery_codes": recovery_codes}


@app.post("/api/auth/mfa/disable", dependencies=[Depends(verify_csrf)])
def mfa_disable(payload: MfaDisableIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=422, detail="Password is incorrect.")
    valid, _recovery = verify_mfa_or_recovery(user, payload.code)
    if not valid:
        raise HTTPException(status_code=422, detail="Invalid authenticator or recovery code.")
    user.mfa_secret = ""
    user.mfa_pending_secret = ""
    user.mfa_enabled = False
    user.mfa_recovery_hashes = "[]"
    user.mfa_setup_at = None
    audit(db, user, "auth.mfa_disabled", "user", user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True}


@app.get("/api/bootstrap")
def bootstrap(db: Annotated[Session, Depends(get_db)], session=Depends(get_current_session)):
    user = session.user
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    return {
        "user": user_dict(user), "csrf_token": session.csrf_token,
        "settings": get_settings(db), "risk_questions": RISK_QUESTIONS,
        "checklist_items": CHECKLIST_ITEMS, "permissions": sorted(ROLE_PERMISSIONS.get(user.role, set())),
        "unread_notifications": unread, "app_version": settings.app_version,
    }


@app.get("/api/dashboard")
def dashboard(db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:view"))]):
    base = select(Journey)
    if user.division != "All Divisions" and user.role not in {"admin", "control"}:
        base = base.where(or_(Journey.division == user.division, Journey.requester_id == user.id))
    journeys = db.scalars(base).all()
    now = utcnow()
    active = [j for j in journeys if j.status in {"departed", "suspended"}]
    pending = [j for j in journeys if j.status == "pending_approval"]
    overdue = [j for j in journeys if j.status == "departed" and j.next_checkin_at and j.next_checkin_at < now]
    closed_today = [j for j in journeys if j.status == "closed" and j.updated_at.date() == now.date()]
    upcoming = sorted([j for j in journeys if j.status == "approved" and j.departure_at >= now], key=lambda x: x.departure_at)[:5]
    recent = sorted(journeys, key=lambda x: x.updated_at, reverse=True)[:8]
    return {
        "stats": {"active": len(active), "pending": len(pending), "overdue": len(overdue), "closed_today": len(closed_today), "total": len(journeys)},
        "upcoming": [journey_dict(j, False) for j in upcoming],
        "recent": [journey_dict(j, False) for j in recent],
        "overdue": [journey_dict(j, False) for j in overdue[:10]],
    }


@app.get("/api/journeys")
def list_journeys(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_permission("journey:view"))],
    q: str = "", status_filter: str = Query("", alias="status"), risk: str = "", limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
):
    stmt = select(Journey).options(selectinload(Journey.vehicle), selectinload(Journey.driver), selectinload(Journey.requester))
    if user.division != "All Divisions" and user.role not in {"admin", "control"}:
        stmt = stmt.where(or_(Journey.division == user.division, Journey.requester_id == user.id))
    if status_filter:
        stmt = stmt.where(Journey.status == status_filter)
    if risk:
        stmt = stmt.where(Journey.risk_level == risk)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Journey.journey_no.ilike(term), Journey.start_location.ilike(term), Journey.end_location.ilike(term), Journey.purpose.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Journey.created_at.desc()).offset(offset).limit(limit)).all()
    return {"items": [journey_dict(j, False) for j in rows], "total": total, "limit": limit, "offset": offset}


@app.get("/api/journeys/{journey_id}")
def get_journey(journey_id: int, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:view"))]):
    journey = load_journey(db, journey_id)
    if user.division != "All Divisions" and user.role not in {"admin", "control"} and journey.division != user.division and journey.requester_id != user.id:
        raise HTTPException(status_code=403, detail="Journey is outside your assigned division.")
    return journey_dict(journey)


@app.post("/api/journeys", dependencies=[Depends(verify_csrf)])
def create_journey(payload: JourneyCreateIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:create"))]):
    journey = Journey(
        journey_no=f"TMP-{secrets.token_hex(8)}", division=payload.division.strip(), site=payload.site.strip(), purpose=payload.purpose.strip(),
        start_location=payload.start_location.strip(), end_location=payload.end_location.strip(), departure_at=payload.departure_at,
        estimated_arrival_at=payload.estimated_arrival_at, distance_km=payload.distance_km, night_drive=payload.night_drive,
        load_type=payload.load_type, passengers=payload.passengers.strip(), vehicle_id=payload.vehicle_id, driver_id=payload.driver_id,
        requester_id=user.id, status="draft", version=1,
    )
    db.add(journey)
    db.flush()
    prefix = str(get_settings(db).get("company_code", "MIT")).upper()
    journey.journey_no = f"{prefix}-{utcnow().year}-{journey.id:06d}"
    if payload.submit:
        submit_journey(db, journey, payload, user)
    else:
        driver = db.get(Driver, payload.driver_id) if payload.driver_id else None
        score, level, _answers = calculate_risk(payload, driver, get_settings(db), False)
        journey.risk_score = score
        journey.risk_level = level
        add_event(db, journey, user, "draft_created", "Journey saved as draft.")
    audit(db, user, "journey.create", "journey", journey.id, {"journey_no": journey.journey_no, "status": journey.status}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.put("/api/journeys/{journey_id}", dependencies=[Depends(verify_csrf)])
def update_journey(journey_id: int, payload: JourneyUpdateIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    journey = load_journey(db, journey_id)
    if not can_edit_journey(user, journey):
        raise HTTPException(status_code=403, detail="This journey cannot be edited by your account in its current status.")
    if journey.version != payload.version:
        raise HTTPException(status_code=409, detail="This journey was updated by another user. Reload before saving.")
    from .services import apply_payload
    if payload.submit:
        submit_journey(db, journey, payload, user)
    else:
        apply_payload(journey, payload)
        journey.status = "draft"
        journey.rejection_reason = ""
        driver = db.get(Driver, payload.driver_id) if payload.driver_id else None
        score, level, _answers = calculate_risk(payload, driver, get_settings(db), False)
        journey.risk_score = score
        journey.risk_level = level
        add_event(db, journey, user, "draft_updated", "Journey draft updated.")
    audit(db, user, "journey.update", "journey", journey.id, {"status": journey.status}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.post("/api/journeys/{journey_id}/approve", dependencies=[Depends(verify_csrf)])
def approve(journey_id: int, payload: DecisionIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:approve"))]):
    journey = load_journey(db, journey_id)
    approve_journey(db, journey, user, payload.comment)
    audit(db, user, "journey.approve", "journey", journey.id, {"comment": payload.comment}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.post("/api/journeys/{journey_id}/reject", dependencies=[Depends(verify_csrf)])
def reject(journey_id: int, payload: ReasonIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:approve"))]):
    journey = load_journey(db, journey_id)
    reject_or_return(db, journey, user, payload.reason, "rejected")
    audit(db, user, "journey.reject", "journey", journey.id, {"reason": payload.reason}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.post("/api/journeys/{journey_id}/return", dependencies=[Depends(verify_csrf)])
def return_for_correction(journey_id: int, payload: ReasonIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:approve"))]):
    journey = load_journey(db, journey_id)
    reject_or_return(db, journey, user, payload.reason, "returned")
    audit(db, user, "journey.return", "journey", journey.id, {"reason": payload.reason}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.post("/api/journeys/{journey_id}/transition", dependencies=[Depends(verify_csrf)])
def transition(journey_id: int, payload: TransitionIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:transition"))]):
    journey = load_journey(db, journey_id)
    transition_journey(db, journey, user, payload.status, payload.comment)
    audit(db, user, "journey.transition", "journey", journey.id, {"to": payload.status, "comment": payload.comment}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.post("/api/journeys/{journey_id}/checkin", dependencies=[Depends(verify_csrf)])
def checkin(journey_id: int, payload: CheckinIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:checkin"))]):
    journey = load_journey(db, journey_id)
    record_checkin(db, journey, user, payload.comment, payload.location)
    audit(db, user, "journey.checkin", "journey", journey.id, {"location": payload.location}, client_ip(request))
    db.commit()
    return journey_dict(load_journey(db, journey.id))


@app.get("/api/journeys/{journey_id}/events")
def journey_events(journey_id: int, db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("journey:view"))]):
    load_journey(db, journey_id)
    events = db.scalars(select(JourneyEvent).options(selectinload(JourneyEvent.actor)).where(JourneyEvent.journey_id == journey_id).order_by(JourneyEvent.created_at.desc())).all()
    return {"items": [event_dict(event) for event in events]}


@app.get("/api/approvals")
def approval_queue(db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("journey:approve"))]):
    stmt = select(Journey).options(
        selectinload(Journey.vehicle), selectinload(Journey.driver), selectinload(Journey.requester),
        selectinload(Journey.approvals).selectinload(Approval.approver),
        selectinload(Journey.risk_answers), selectinload(Journey.checklist_answers),
    ).join(Approval).where(Journey.status == "pending_approval", Approval.status == "pending")
    if user.role != "admin":
        stmt = stmt.where(Approval.required_role == user.role)
    rows = db.scalars(stmt.order_by(Journey.created_at)).unique().all()
    return {"items": [journey_dict(j) for j in rows if j.requester_id != user.id]}


@app.get("/api/vehicles")
def list_vehicles(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("vehicle:view"))]):
    return {"items": [vehicle_dict(v) for v in db.scalars(select(Vehicle).order_by(Vehicle.plate)).all()]}


@app.post("/api/vehicles", dependencies=[Depends(verify_csrf)])
def create_vehicle(payload: VehicleIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    values = payload.model_dump(exclude={"version"})
    values["plate"] = payload.plate.strip().upper()
    vehicle = Vehicle(**values)
    db.add(vehicle)
    db.flush()
    audit(db, user, "vehicle.create", "vehicle", vehicle.id, {"plate": vehicle.plate}, client_ip(request))
    db.commit()
    return vehicle_dict(vehicle)


@app.put("/api/vehicles/{vehicle_id}", dependencies=[Depends(verify_csrf)])
def update_vehicle(vehicle_id: int, payload: VehicleIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found.")
    if payload.version is not None and payload.version != vehicle.version:
        raise HTTPException(409, "Vehicle was updated by another user.")
    for key, value in payload.model_dump(exclude={"version"}).items():
        setattr(vehicle, key, value)
    vehicle.plate = vehicle.plate.strip().upper()
    vehicle.version += 1
    audit(db, user, "vehicle.update", "vehicle", vehicle.id, {"plate": vehicle.plate}, client_ip(request))
    db.commit()
    return vehicle_dict(vehicle)


@app.delete("/api/vehicles/{vehicle_id}", dependencies=[Depends(verify_csrf)])
def delete_vehicle(vehicle_id: int, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found.")
    used = db.scalar(select(func.count()).select_from(Journey).where(Journey.vehicle_id == vehicle_id)) or 0
    if used:
        raise HTTPException(409, "Vehicle is referenced by journeys and cannot be deleted. Set it to blacklisted instead.")
    audit(db, user, "vehicle.delete", "vehicle", vehicle.id, {"plate": vehicle.plate}, client_ip(request))
    db.delete(vehicle)
    db.commit()
    return {"ok": True}


@app.get("/api/drivers")
def list_drivers(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("driver:view"))]):
    return {"items": [driver_dict(d) for d in db.scalars(select(Driver).order_by(Driver.name)).all()]}


@app.post("/api/drivers", dependencies=[Depends(verify_csrf)])
def create_driver(payload: DriverIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    values = payload.model_dump(exclude={"version"})
    values["name"] = payload.name.strip()
    driver = Driver(**values)
    db.add(driver)
    db.flush()
    audit(db, user, "driver.create", "driver", driver.id, {"name": driver.name}, client_ip(request))
    db.commit()
    return driver_dict(driver)


@app.put("/api/drivers/{driver_id}", dependencies=[Depends(verify_csrf)])
def update_driver(driver_id: int, payload: DriverIn, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(404, "Driver not found.")
    if payload.version is not None and payload.version != driver.version:
        raise HTTPException(409, "Driver was updated by another user.")
    for key, value in payload.model_dump(exclude={"version"}).items():
        setattr(driver, key, value)
    driver.name = driver.name.strip()
    driver.version += 1
    audit(db, user, "driver.update", "driver", driver.id, {"name": driver.name}, client_ip(request))
    db.commit()
    return driver_dict(driver)


@app.delete("/api/drivers/{driver_id}", dependencies=[Depends(verify_csrf)])
def delete_driver(driver_id: int, request: Request, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(require_permission("*"))]):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(404, "Driver not found.")
    used = db.scalar(select(func.count()).select_from(Journey).where(Journey.driver_id == driver_id)) or 0
    if used:
        raise HTTPException(409, "Driver is referenced by journeys and cannot be deleted. Set the driver to restricted instead.")
    audit(db, user, "driver.delete", "driver", driver.id, {"name": driver.name}, client_ip(request))
    db.delete(driver)
    db.commit()
    return {"ok": True}


@app.get("/api/users")
def list_users(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("*"))]):
    return {"items": [user_dict(u) for u in db.scalars(select(User).order_by(User.name)).all()]}


@app.post("/api/users", dependencies=[Depends(verify_csrf)])
def create_user(payload: UserCreateIn, request: Request, db: Annotated[Session, Depends(get_db)], admin: Annotated[User, Depends(require_permission("*"))]):
    errors = validate_password(payload.password)
    if errors:
        raise HTTPException(422, detail={"message": "Password does not meet policy.", "errors": errors})
    user = User(
        name=payload.name.strip(), email=str(payload.email).lower(), title=payload.title.strip(),
        division=payload.division.strip(), role=payload.role, password_hash=hash_password(payload.password),
        active=payload.active, must_change_password=payload.must_change_password,
    )
    db.add(user)
    db.flush()
    audit(db, admin, "user.create", "user", user.id, {"email": user.email, "role": user.role}, client_ip(request))
    db.commit()
    return user_dict(user)


@app.put("/api/users/{user_id}", dependencies=[Depends(verify_csrf)])
def update_user(user_id: int, payload: UserUpdateIn, request: Request, db: Annotated[Session, Depends(get_db)], admin: Annotated[User, Depends(require_permission("*"))]):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    values = payload.model_dump(exclude_none=True)
    if user.id == admin.id and values.get("active") is False:
        raise HTTPException(409, "You cannot deactivate your own account.")
    if user.role == "admin" and values.get("role") not in {None, "admin"}:
        admin_count = db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.active.is_(True))) or 0
        if admin_count <= 1:
            raise HTTPException(409, "At least one active administrator is required.")
    for key, value in values.items():
        setattr(user, key, value.strip() if isinstance(value, str) else value)
    audit(db, admin, "user.update", "user", user.id, values, client_ip(request))
    db.commit()
    return user_dict(user)


@app.post("/api/users/{user_id}/reset-password", dependencies=[Depends(verify_csrf)])
def reset_password(user_id: int, payload: PasswordResetIn, request: Request, db: Annotated[Session, Depends(get_db)], admin: Annotated[User, Depends(require_permission("*"))]):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    errors = validate_password(payload.new_password)
    if errors:
        raise HTTPException(422, detail={"message": "Password does not meet policy.", "errors": errors})
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = payload.must_change_password
    sessions = db.scalars(select(SessionToken).where(SessionToken.user_id == user.id)).all()
    for session in sessions:
        db.delete(session)
    audit(db, admin, "user.password_reset", "user", user.id, {}, client_ip(request))
    db.commit()
    return {"ok": True}


@app.post("/api/users/{user_id}/reset-mfa", dependencies=[Depends(verify_csrf)])
def reset_mfa(user_id: int, request: Request, db: Annotated[Session, Depends(get_db)], admin: Annotated[User, Depends(require_permission("*"))]):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found.")
    user.mfa_secret = ""
    user.mfa_pending_secret = ""
    user.mfa_enabled = False
    user.mfa_recovery_hashes = "[]"
    user.mfa_setup_at = None
    sessions = db.scalars(select(SessionToken).where(SessionToken.user_id == user.id)).all()
    for session in sessions:
        db.delete(session)
    audit(db, admin, "user.mfa_reset", "user", user.id, {}, client_ip(request))
    db.commit()
    return {"ok": True}


@app.get("/api/notifications")
def notifications(db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)], limit: int = Query(100, ge=1, le=500)):
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)).all()
    return {"items": [notification_dict(n) for n in rows]}


@app.post("/api/notifications/{notification_id}/read", dependencies=[Depends(verify_csrf)])
def mark_notification(notification_id: int, db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(404, "Notification not found.")
    notification.read_at = notification.read_at or utcnow()
    db.commit()
    return notification_dict(notification)


@app.get("/api/settings")
def settings_get(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("*"))]):
    return get_settings(db)


@app.put("/api/settings", dependencies=[Depends(verify_csrf)])
def settings_update(payload: SettingsIn, request: Request, db: Annotated[Session, Depends(get_db)], admin: Annotated[User, Depends(require_permission("*"))]):
    data = save_settings(db, payload)
    audit(db, admin, "settings.update", "system", "settings", payload.model_dump(), client_ip(request))
    db.commit()
    return data


@app.get("/api/audit")
def audit_list(
    db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("*"))],
    q: str = "", limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
):
    stmt = select(AuditLog).options(selectinload(AuditLog.actor))
    if q:
        term = f"%{q}%"
        stmt = stmt.where(or_(AuditLog.action.ilike(term), AuditLog.entity_type.ilike(term), AuditLog.entity_id.ilike(term)))
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)).all()
    return {"items": [{
        "id": row.id, "actor_name": row.actor.name if row.actor else "System", "action": row.action,
        "entity_type": row.entity_type, "entity_id": row.entity_id,
        "details": json.loads(row.details_json or "{}"), "ip_address": row.ip_address,
        "created_at": row.created_at.isoformat(),
    } for row in rows]}


@app.get("/api/readiness")
def readiness(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("*"))]):
    today = date.today()
    active_admins = db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.active.is_(True))) or 0
    approvers = db.scalar(select(func.count()).select_from(User).where(User.role == "approver", User.active.is_(True))) or 0
    hse = db.scalar(select(func.count()).select_from(User).where(User.role == "hse", User.active.is_(True))) or 0
    valid_vehicles = db.scalar(select(func.count()).select_from(Vehicle).where(
        Vehicle.status == "active", Vehicle.license_expiry >= today, Vehicle.insurance_expiry >= today, Vehicle.inspection_expiry >= today,
    )) or 0
    valid_drivers = db.scalar(select(func.count()).select_from(Driver).where(
        Driver.status == "active", Driver.drug_test == "Clear", Driver.license_expiry >= today,
        Driver.ddc_expiry >= today, Driver.medical_expiry >= today, Driver.defensive_expiry >= today,
    )) or 0
    current_settings = get_settings(db)
    active_users = db.scalar(select(func.count()).select_from(User).where(User.active.is_(True))) or 0
    mfa_users = db.scalar(select(func.count()).select_from(User).where(User.active.is_(True), User.mfa_enabled.is_(True))) or 0
    mfa_required = bool(current_settings.get("require_mfa", False))
    checks = [
        {"name": "Active administrator", "ok": active_admins >= 1, "value": active_admins},
        {"name": "Operational approver", "ok": approvers >= 1, "value": approvers},
        {"name": "HSE approver", "ok": hse >= 1, "value": hse},
        {"name": "Valid active vehicle", "ok": valid_vehicles >= 1, "value": valid_vehicles},
        {"name": "Valid active driver", "ok": valid_drivers >= 1, "value": valid_drivers},
        {"name": "HTTPS secure-cookie mode", "ok": settings.cookie_secure, "value": settings.cookie_secure},
        {"name": "Production environment", "ok": settings.environment == "production", "value": settings.environment},
        {"name": "MFA coverage", "ok": (not mfa_required) or (active_users > 0 and mfa_users == active_users), "value": f"{mfa_users}/{active_users}" if mfa_required else "Optional"},
    ]
    score = round(sum(1 for c in checks if c["ok"]) / len(checks) * 100)
    return {"score": score, "checks": checks, "ready": score == 100}


@app.get("/api/export/journeys.csv")
def export_journeys(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("report:view"))]):
    rows = db.scalars(select(Journey).options(selectinload(Journey.vehicle), selectinload(Journey.driver), selectinload(Journey.requester)).order_by(Journey.created_at.desc())).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Journey No", "Status", "Risk", "Division", "Requester", "Driver", "Vehicle", "From", "To", "Departure", "Estimated Arrival", "Distance KM"])
    for j in rows:
        writer.writerow([j.journey_no, j.status, j.risk_level, j.division, j.requester.name, j.driver.name if j.driver else "", j.vehicle.plate if j.vehicle else "", j.start_location, j.end_location, j.departure_at.isoformat(), j.estimated_arrival_at.isoformat(), j.distance_km])
    payload = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(io.BytesIO(payload), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=moveintrack-journeys-{date.today().isoformat()}.csv"})


@app.get("/api/admin/export-data")
def export_data(db: Annotated[Session, Depends(get_db)], _user: Annotated[User, Depends(require_permission("*"))]):
    data = {
        "exported_at": utcnow().isoformat() + "Z", "app_version": settings.app_version,
        "settings": get_settings(db),
        "users": [user_dict(u) for u in db.scalars(select(User)).all()],
        "vehicles": [vehicle_dict(v) for v in db.scalars(select(Vehicle)).all()],
        "drivers": [driver_dict(d) for d in db.scalars(select(Driver)).all()],
        "journeys": [journey_dict(load_journey(db, j.id)) for j in db.scalars(select(Journey)).all()],
    }
    content = json.dumps(data, indent=2, ensure_ascii=False, default=str).encode("utf-8")
    return StreamingResponse(io.BytesIO(content), media_type="application/json", headers={"Content-Disposition": f"attachment; filename=moveintrack-data-{date.today().isoformat()}.json"})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/service-worker.js")
def service_worker():
    return FileResponse(STATIC_DIR / "service-worker.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/{path:path}")
def spa(path: str):
    # API misses should remain JSON 404s instead of returning the SPA.
    if path.startswith("api/"):
        raise HTTPException(404, "API route not found.")
    candidate = STATIC_DIR / path
    if path and candidate.exists() and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(STATIC_DIR / "index.html")
