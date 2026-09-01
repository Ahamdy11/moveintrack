from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .models import (
    Approval, AuditLog, ChecklistAnswer, Driver, Journey, JourneyEvent,
    Notification, RiskAnswer, SystemSetting, User, Vehicle,
)
from .schemas import JourneyCreateIn, SettingsIn



def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)

RISK_QUESTIONS: list[dict[str, Any]] = [
    {"key": "night_drive", "text": "Is this a night drive trip?", "weight": 3, "derived": True},
    {"key": "remote_area", "text": "Does the route pass through remote areas with no cell coverage?", "weight": 2},
    {"key": "poor_road", "text": "Is road condition poor or unpaved for more than 50% of the route?", "weight": 2},
    {"key": "over_4_hours", "text": "Will the trip exceed 4 hours one-way?", "weight": 2, "derived": True},
    {"key": "dangerous_goods", "text": "Is the vehicle carrying dangerous goods?", "weight": 3, "derived": True},
    {"key": "adverse_weather", "text": "Are weather conditions adverse (sandstorm, fog or rain)?", "weight": 2},
    {"key": "no_second_driver", "text": "Is a second driver unavailable for a trip over 4 hours?", "weight": 1},
    {"key": "driver_rest", "text": "Does the driver have less than the required rest before this trip?", "weight": 3, "derived": True},
]

CHECKLIST_ITEMS: list[dict[str, str]] = [
    {"key": "vehicle_inspection", "text": "Vehicle pre-trip inspection completed"},
    {"key": "passenger_briefing", "text": "All passengers briefed on safety"},
    {"key": "emergency_contacts", "text": "Emergency contacts confirmed with driver"},
    {"key": "first_aid", "text": "First aid kit available in vehicle"},
    {"key": "extinguisher", "text": "Fire extinguisher present and valid"},
    {"key": "communication", "text": "Communication device tested"},
    {"key": "route_shared", "text": "Route plan shared with Control Room"},
    {"key": "documents_valid", "text": "Driver license and vehicle documents valid"},
    {"key": "ddc_valid", "text": "Driver DDC certificate valid"},
    {"key": "fuel", "text": "Fuel level adequate for route and reserve"},
]

DEFAULT_SETTINGS = SettingsIn().model_dump()
ACTIVE_CONFLICT_STATUSES = {"pending_approval", "approved", "departed", "suspended"}


def iso(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def user_dict(user: User) -> dict[str, Any]:
    return {
        "id": user.id, "email": user.email, "name": user.name, "title": user.title,
        "division": user.division, "role": user.role, "active": user.active,
        "must_change_password": user.must_change_password, "mfa_enabled": user.mfa_enabled,
        "last_login_at": iso(user.last_login_at), "created_at": iso(user.created_at),
    }


def vehicle_dict(v: Vehicle) -> dict[str, Any]:
    return {
        "id": v.id, "plate": v.plate, "model": v.model, "contractor": v.contractor,
        "vehicle_type": v.vehicle_type, "license_expiry": iso(v.license_expiry),
        "insurance_expiry": iso(v.insurance_expiry), "inspection_expiry": iso(v.inspection_expiry),
        "maintenance_due": iso(v.maintenance_due), "gps_status": v.gps_status,
        "status": v.status, "notes": v.notes, "version": v.version,
        "created_at": iso(v.created_at), "updated_at": iso(v.updated_at),
    }


def driver_dict(d: Driver) -> dict[str, Any]:
    return {
        "id": d.id, "name": d.name, "phone": d.phone, "license_class": d.license_class,
        "license_expiry": iso(d.license_expiry), "ddc_expiry": iso(d.ddc_expiry),
        "medical_expiry": iso(d.medical_expiry), "defensive_expiry": iso(d.defensive_expiry),
        "drug_test": d.drug_test, "rest_hours": d.rest_hours, "status": d.status,
        "notes": d.notes, "version": d.version, "created_at": iso(d.created_at),
        "updated_at": iso(d.updated_at),
    }


def approval_dict(a: Approval) -> dict[str, Any]:
    return {
        "id": a.id, "stage": a.stage, "required_role": a.required_role,
        "approver_id": a.approver_id, "approver_name": a.approver.name if a.approver else None,
        "status": a.status, "comment": a.comment, "acted_at": iso(a.acted_at),
        "created_at": iso(a.created_at),
    }


def journey_dict(j: Journey, include_detail: bool = True) -> dict[str, Any]:
    data = {
        "id": j.id, "journey_no": j.journey_no, "division": j.division, "site": j.site,
        "purpose": j.purpose, "start_location": j.start_location, "end_location": j.end_location,
        "departure_at": iso(j.departure_at), "estimated_arrival_at": iso(j.estimated_arrival_at),
        "actual_departure_at": iso(j.actual_departure_at), "actual_arrival_at": iso(j.actual_arrival_at),
        "distance_km": j.distance_km, "night_drive": j.night_drive, "load_type": j.load_type,
        "passengers": j.passengers, "vehicle_id": j.vehicle_id, "vehicle": vehicle_dict(j.vehicle) if j.vehicle else None,
        "driver_id": j.driver_id, "driver": driver_dict(j.driver) if j.driver else None,
        "requester_id": j.requester_id, "requester": user_dict(j.requester),
        "risk_score": j.risk_score, "risk_level": j.risk_level, "status": j.status,
        "rejection_reason": j.rejection_reason, "checkin_interval_minutes": j.checkin_interval_minutes,
        "last_checkin_at": iso(j.last_checkin_at), "next_checkin_at": iso(j.next_checkin_at),
        "overdue_minutes": max(0, int((utcnow() - j.next_checkin_at).total_seconds() / 60)) if j.next_checkin_at and j.status == "departed" and j.next_checkin_at < utcnow() else 0,
        "version": j.version, "created_at": iso(j.created_at), "updated_at": iso(j.updated_at),
    }
    if include_detail:
        data["approvals"] = [approval_dict(a) for a in sorted(j.approvals, key=lambda x: x.stage)]
        data["risk_answers"] = [
            {"question_key": a.question_key, "question_text": a.question_text, "answer": a.answer, "weight": a.weight}
            for a in j.risk_answers
        ]
        data["checklist_answers"] = [
            {"item_key": a.item_key, "item_text": a.item_text, "confirmed": a.confirmed}
            for a in j.checklist_answers
        ]
    return data


def notification_dict(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id, "title": n.title, "message": n.message, "severity": n.severity,
        "journey_id": n.journey_id, "read_at": iso(n.read_at), "created_at": iso(n.created_at),
    }


def event_dict(e: JourneyEvent) -> dict[str, Any]:
    return {
        "id": e.id, "event_type": e.event_type, "message": e.message,
        "actor_id": e.actor_id, "actor_name": e.actor.name if e.actor else "System",
        "metadata": json.loads(e.metadata_json or "{}"), "created_at": iso(e.created_at),
    }


def get_settings(db: Session) -> dict[str, Any]:
    data = DEFAULT_SETTINGS.copy()
    for row in db.scalars(select(SystemSetting)).all():
        try:
            data[row.key] = json.loads(row.value)
        except json.JSONDecodeError:
            data[row.key] = row.value
    return data


def save_settings(db: Session, payload: SettingsIn) -> dict[str, Any]:
    for key, value in payload.model_dump().items():
        row = db.get(SystemSetting, key)
        encoded = json.dumps(value)
        if row:
            row.value = encoded
        else:
            db.add(SystemSetting(key=key, value=encoded))
    db.commit()
    return get_settings(db)


def audit(db: Session, actor: User | None, action: str, entity_type: str, entity_id: Any = "", details: dict[str, Any] | None = None, ip: str = "") -> None:
    db.add(AuditLog(
        actor_id=actor.id if actor else None,
        action=action, entity_type=entity_type, entity_id=str(entity_id or ""),
        details_json=json.dumps(details or {}, default=str), ip_address=ip,
    ))


def add_event(db: Session, journey: Journey, actor: User | None, event_type: str, message: str, metadata: dict[str, Any] | None = None) -> None:
    db.add(JourneyEvent(
        journey_id=journey.id, actor_id=actor.id if actor else None, event_type=event_type,
        message=message, metadata_json=json.dumps(metadata or {}, default=str),
    ))


def notify_user(db: Session, user_id: int, title: str, message: str, severity: str = "info", journey_id: int | None = None) -> None:
    db.add(Notification(user_id=user_id, title=title, message=message, severity=severity, journey_id=journey_id))


def notify_role(db: Session, role: str, title: str, message: str, journey_id: int | None = None, exclude_user_id: int | None = None) -> None:
    users = db.scalars(select(User).where(User.active.is_(True), or_(User.role == role, User.role == "admin"))).all()
    for user in users:
        if exclude_user_id and user.id == exclude_user_id:
            continue
        notify_user(db, user.id, title, message, "warning", journey_id)


def load_journey(db: Session, journey_id: int) -> Journey:
    journey = db.scalar(
        select(Journey)
        .options(
            selectinload(Journey.vehicle), selectinload(Journey.driver), selectinload(Journey.requester),
            selectinload(Journey.approvals).selectinload(Approval.approver),
            selectinload(Journey.risk_answers), selectinload(Journey.checklist_answers),
        )
        .where(Journey.id == journey_id)
    )
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found.")
    return journey


def next_journey_no(db: Session) -> str:
    settings = get_settings(db)
    prefix = str(settings.get("company_code", "MIT")).upper()
    year = utcnow().year
    pattern = f"{prefix}-{year}-%"
    rows = db.scalars(select(Journey.journey_no).where(Journey.journey_no.like(pattern))).all()
    max_seq = 0
    for number in rows:
        try:
            max_seq = max(max_seq, int(number.rsplit("-", 1)[-1]))
        except (ValueError, AttributeError):
            continue
    return f"{prefix}-{year}-{max_seq + 1:06d}"


def derived_risk_answers(payload: JourneyCreateIn, driver: Driver | None, settings: dict[str, Any]) -> dict[str, bool]:
    duration_hours = (payload.estimated_arrival_at - payload.departure_at).total_seconds() / 3600
    return {
        "night_drive": bool(payload.night_drive),
        "over_4_hours": duration_hours > 4,
        "dangerous_goods": payload.load_type == "Dangerous Goods",
        "driver_rest": bool(driver and driver.rest_hours < float(settings.get("minimum_rest_hours", 8))),
    }


def calculate_risk(payload: JourneyCreateIn, driver: Driver | None, settings: dict[str, Any], require_all: bool) -> tuple[int, str, list[dict[str, Any]]]:
    supplied = {item.question_key: item.answer for item in payload.risk_answers}
    supplied.update(derived_risk_answers(payload, driver, settings))
    missing = [q["key"] for q in RISK_QUESTIONS if q["key"] not in supplied]
    if require_all and missing:
        raise HTTPException(status_code=422, detail={"message": "Complete all risk questions.", "missing": missing})
    answers: list[dict[str, Any]] = []
    score = 0
    for q in RISK_QUESTIONS:
        answer = bool(supplied.get(q["key"], False))
        if answer:
            score += int(q["weight"])
        answers.append({**q, "answer": answer})
    max_score = sum(int(q["weight"]) for q in RISK_QUESTIONS)
    percentage = score / max_score if max_score else 0
    level = "low" if percentage < 0.25 else "medium" if percentage < 0.55 else "high"
    return score, level, answers


def _date_valid(value: date | None, journey_date: date, label: str, errors: list[str]) -> None:
    if not value:
        errors.append(f"{label} is missing.")
    elif value < journey_date:
        errors.append(f"{label} expires before the journey.")


def validate_resources(db: Session, payload: JourneyCreateIn, exclude_journey_id: int | None = None) -> tuple[Vehicle, Driver]:
    if not payload.vehicle_id or not payload.driver_id:
        raise HTTPException(status_code=422, detail="Vehicle and driver are required before submission.")
    vehicle = db.get(Vehicle, payload.vehicle_id)
    driver = db.get(Driver, payload.driver_id)
    if not vehicle or not driver:
        raise HTTPException(status_code=422, detail="Selected vehicle or driver no longer exists.")

    settings = get_settings(db)
    errors: list[str] = []
    journey_date = payload.departure_at.date()

    if vehicle.status != "active":
        errors.append(f"Vehicle is {vehicle.status}.")
    _date_valid(vehicle.license_expiry, journey_date, "Vehicle license", errors)
    _date_valid(vehicle.insurance_expiry, journey_date, "Vehicle insurance", errors)
    _date_valid(vehicle.inspection_expiry, journey_date, "Vehicle inspection", errors)
    if vehicle.maintenance_due and vehicle.maintenance_due < journey_date:
        errors.append("Vehicle maintenance is overdue.")
    if settings.get("require_gps", True) and vehicle.gps_status != "Active":
        errors.append("Active GPS is required for this vehicle.")

    if driver.status != "active":
        errors.append(f"Driver is {driver.status}.")
    if driver.drug_test != "Clear":
        errors.append(f"Driver drug test status is {driver.drug_test}.")
    _date_valid(driver.license_expiry, journey_date, "Driver license", errors)
    _date_valid(driver.ddc_expiry, journey_date, "Driver DDC", errors)
    _date_valid(driver.medical_expiry, journey_date, "Driver medical fitness", errors)
    _date_valid(driver.defensive_expiry, journey_date, "Defensive driving training", errors)
    if driver.rest_hours < float(settings.get("minimum_rest_hours", 8)):
        errors.append(f"Driver rest is {driver.rest_hours:g} hours; minimum is {settings.get('minimum_rest_hours', 8)}.")
    if any(word in vehicle.vehicle_type.lower() for word in ("heavy", "truck", "jumbo")) and not any(word in driver.license_class.lower() for word in ("3", "heavy")):
        errors.append("Driver license class is not valid for a heavy vehicle.")

    conflict_filter = [
        Journey.status.in_(ACTIVE_CONFLICT_STATUSES),
        Journey.departure_at < payload.estimated_arrival_at,
        Journey.estimated_arrival_at > payload.departure_at,
    ]
    if exclude_journey_id:
        conflict_filter.append(Journey.id != exclude_journey_id)
    conflict = db.scalar(select(Journey).where(and_(*conflict_filter), or_(Journey.vehicle_id == vehicle.id, Journey.driver_id == driver.id)))
    if conflict:
        if conflict.vehicle_id == vehicle.id:
            errors.append(f"Vehicle conflicts with {conflict.journey_no}.")
        if conflict.driver_id == driver.id:
            errors.append(f"Driver conflicts with {conflict.journey_no}.")

    if errors:
        raise HTTPException(status_code=422, detail={"message": "Journey cannot be submitted.", "errors": errors})
    return vehicle, driver


def validate_checklist(payload: JourneyCreateIn) -> list[dict[str, Any]]:
    supplied = {item.item_key: item.confirmed for item in payload.checklist_answers}
    missing = [item["key"] for item in CHECKLIST_ITEMS if supplied.get(item["key"]) is not True]
    if missing:
        raise HTTPException(status_code=422, detail={"message": "Confirm all mandatory checklist items.", "missing": missing})
    return [{**item, "confirmed": True} for item in CHECKLIST_ITEMS]


def replace_assessments(db: Session, journey: Journey, risk_answers: list[dict[str, Any]], checklist_answers: list[dict[str, Any]]) -> None:
    journey.risk_answers.clear()
    journey.checklist_answers.clear()
    for item in risk_answers:
        journey.risk_answers.append(RiskAnswer(
            question_key=item["key"], question_text=item["text"], answer=item["answer"], weight=item["weight"],
        ))
    for item in checklist_answers:
        journey.checklist_answers.append(ChecklistAnswer(
            item_key=item["key"], item_text=item["text"], confirmed=item["confirmed"],
        ))


def apply_payload(journey: Journey, payload: JourneyCreateIn) -> None:
    journey.division = payload.division.strip()
    journey.site = payload.site.strip()
    journey.purpose = payload.purpose.strip()
    journey.start_location = payload.start_location.strip()
    journey.end_location = payload.end_location.strip()
    journey.departure_at = payload.departure_at
    journey.estimated_arrival_at = payload.estimated_arrival_at
    journey.distance_km = payload.distance_km
    journey.night_drive = payload.night_drive
    journey.load_type = payload.load_type
    journey.passengers = payload.passengers.strip()
    journey.vehicle_id = payload.vehicle_id
    journey.driver_id = payload.driver_id
    journey.version += 1


def configure_approvals(db: Session, journey: Journey) -> None:
    journey.approvals.clear()
    journey.approvals.append(Approval(stage=1, required_role="approver", status="pending"))
    if journey.risk_level == "high":
        journey.approvals.append(Approval(stage=2, required_role="hse", status="waiting"))


def submit_journey(db: Session, journey: Journey, payload: JourneyCreateIn, actor: User) -> None:
    _vehicle, driver = validate_resources(db, payload, journey.id)
    settings = get_settings(db)
    score, level, risk = calculate_risk(payload, driver, settings, True)
    checklist = validate_checklist(payload)
    apply_payload(journey, payload)
    journey.risk_score = score
    journey.risk_level = level
    interval_key = f"{level}_checkin_minutes"
    journey.checkin_interval_minutes = int(settings.get(interval_key, 120))
    journey.status = "pending_approval"
    journey.rejection_reason = ""
    replace_assessments(db, journey, risk, checklist)
    configure_approvals(db, journey)
    add_event(db, journey, actor, "submitted", f"Journey submitted for approval with {level.upper()} risk.")
    notify_role(db, "approver", "Journey approval required", f"{journey.journey_no} requires your approval.", journey.id, actor.id)


def can_edit_journey(user: User, journey: Journey) -> bool:
    if user.role == "admin":
        return journey.status not in {"departed", "arrived", "closed", "cancelled"}
    return journey.requester_id == user.id and journey.status in {"draft", "returned", "rejected"}


def current_pending_approval(journey: Journey) -> Approval | None:
    return next((a for a in sorted(journey.approvals, key=lambda x: x.stage) if a.status == "pending"), None)


def approve_journey(db: Session, journey: Journey, actor: User, comment: str) -> None:
    if actor.id == journey.requester_id:
        raise HTTPException(status_code=403, detail="The requester cannot approve their own journey.")
    approval = current_pending_approval(journey)
    if not approval:
        raise HTTPException(status_code=409, detail="No pending approval stage is available.")
    if actor.role != "admin" and actor.role != approval.required_role:
        raise HTTPException(status_code=403, detail=f"This stage requires the {approval.required_role} role.")
    approval.status = "approved"
    approval.approver_id = actor.id
    approval.comment = comment.strip()
    approval.acted_at = utcnow()
    next_approval = next((a for a in sorted(journey.approvals, key=lambda x: x.stage) if a.status == "waiting"), None)
    if next_approval:
        next_approval.status = "pending"
        add_event(db, journey, actor, "approval", f"Approval stage {approval.stage} completed. Stage {next_approval.stage} is pending.")
        notify_role(db, next_approval.required_role, "High-risk approval required", f"{journey.journey_no} requires stage {next_approval.stage} approval.", journey.id, journey.requester_id)
    else:
        journey.status = "approved"
        journey.version += 1
        add_event(db, journey, actor, "approved", "Journey fully approved and ready for departure.")
        notify_user(db, journey.requester_id, "Journey approved", f"{journey.journey_no} is approved and ready for departure.", "success", journey.id)


def reject_or_return(db: Session, journey: Journey, actor: User, reason: str, action: str) -> None:
    approval = current_pending_approval(journey)
    if not approval:
        raise HTTPException(status_code=409, detail="No pending approval stage is available.")
    if actor.id == journey.requester_id:
        raise HTTPException(status_code=403, detail="The requester cannot act as approver.")
    if actor.role != "admin" and actor.role != approval.required_role:
        raise HTTPException(status_code=403, detail=f"This stage requires the {approval.required_role} role.")
    approval.status = action
    approval.approver_id = actor.id
    approval.comment = reason
    approval.acted_at = utcnow()
    journey.status = "rejected" if action == "rejected" else "returned"
    journey.rejection_reason = reason
    journey.version += 1
    add_event(db, journey, actor, action, reason)
    notify_user(db, journey.requester_id, f"Journey {journey.status}", f"{journey.journey_no}: {reason}", "error" if action == "rejected" else "warning", journey.id)


def transition_journey(db: Session, journey: Journey, actor: User, new_status: str, comment: str) -> None:
    allowed: dict[str, set[str]] = {
        "approved": {"departed", "cancelled"},
        "departed": {"arrived", "suspended", "cancelled"},
        "suspended": {"departed", "cancelled"},
        "arrived": {"closed"},
        "pending_approval": {"cancelled"},
        "draft": {"cancelled"},
        "returned": {"cancelled"},
        "rejected": {"cancelled"},
    }
    if new_status not in allowed.get(journey.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot change {journey.status} to {new_status}.")
    now = utcnow()
    journey.status = new_status
    journey.version += 1
    if new_status == "departed":
        journey.actual_departure_at = journey.actual_departure_at or now
        journey.last_checkin_at = now
        journey.next_checkin_at = now + timedelta(minutes=journey.checkin_interval_minutes)
    elif new_status == "arrived":
        journey.actual_arrival_at = now
        journey.next_checkin_at = None
    elif new_status in {"closed", "cancelled"}:
        journey.next_checkin_at = None
    add_event(db, journey, actor, new_status, comment.strip() or f"Journey changed to {new_status}.")
    notify_user(db, journey.requester_id, f"Journey {new_status}", f"{journey.journey_no} is now {new_status}.", "info", journey.id)


def record_checkin(db: Session, journey: Journey, actor: User, comment: str, location: str) -> None:
    if journey.status != "departed":
        raise HTTPException(status_code=409, detail="Check-in is available only for departed journeys.")
    now = utcnow()
    journey.last_checkin_at = now
    journey.next_checkin_at = now + timedelta(minutes=journey.checkin_interval_minutes)
    journey.version += 1
    message = comment.strip() or "Driver confirmed safe and on route."
    if location.strip():
        message += f" Location: {location.strip()}."
    add_event(db, journey, actor, "checkin", message, {"location": location.strip()})


def process_overdue_checkins(db: Session) -> int:
    now = utcnow()
    journeys = db.scalars(select(Journey).where(Journey.status == "departed", Journey.next_checkin_at.is_not(None), Journey.next_checkin_at < now)).all()
    created = 0
    for journey in journeys:
        recent_cutoff = now - timedelta(minutes=max(10, journey.checkin_interval_minutes // 2))
        existing = db.scalar(select(Notification.id).where(
            Notification.journey_id == journey.id,
            Notification.title == "Overdue check-in",
            Notification.created_at > recent_cutoff,
        ))
        if existing:
            continue
        control_users = db.scalars(select(User).where(User.active.is_(True), User.role.in_(["admin", "control"]))).all()
        minutes = int((now - journey.next_checkin_at).total_seconds() / 60)
        for user in control_users:
            notify_user(db, user.id, "Overdue check-in", f"{journey.journey_no} is {minutes} minutes overdue for check-in.", "error", journey.id)
            created += 1
    if created:
        db.commit()
    return created
