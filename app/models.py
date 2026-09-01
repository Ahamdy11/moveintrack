from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(160), default="")
    division: Mapped[str] = mapped_column(String(160), default="All Divisions")
    role: Mapped[str] = mapped_column(String(30), index=True, default="viewer")
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    mfa_secret: Mapped[str] = mapped_column(Text, default="")
    mfa_pending_secret: Mapped[str] = mapped_column(Text, default="")
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_recovery_hashes: Mapped[str] = mapped_column(Text, default="[]")
    mfa_setup_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SessionToken(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(96))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ip_address: Mapped[str] = mapped_column(String(80), default="")
    user_agent: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user: Mapped[User] = relationship()


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plate: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    model: Mapped[str] = mapped_column(String(160), default="")
    contractor: Mapped[str] = mapped_column(String(160), default="")
    vehicle_type: Mapped[str] = mapped_column(String(80), default="Light")
    license_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    insurance_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    inspection_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    maintenance_due: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    gps_status: Mapped[str] = mapped_column(String(30), default="Active")
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(80), default="")
    license_class: Mapped[str] = mapped_column(String(80), default="Class 1")
    license_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    ddc_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    medical_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    defensive_expiry: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    drug_test: Mapped[str] = mapped_column(String(30), default="Clear")
    rest_hours: Mapped[float] = mapped_column(Float, default=8.0)
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Journey(Base):
    __tablename__ = "journeys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journey_no: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    division: Mapped[str] = mapped_column(String(160), index=True)
    site: Mapped[str] = mapped_column(String(160), default="")
    purpose: Mapped[str] = mapped_column(Text, default="")
    start_location: Mapped[str] = mapped_column(String(220))
    end_location: Mapped[str] = mapped_column(String(220))
    departure_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    estimated_arrival_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    actual_departure_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_arrival_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    distance_km: Mapped[float] = mapped_column(Float, default=0)
    night_drive: Mapped[bool] = mapped_column(Boolean, default=False)
    load_type: Mapped[str] = mapped_column(String(80), default="Passengers")
    passengers: Mapped[str] = mapped_column(Text, default="")
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id", ondelete="RESTRICT"), nullable=True, index=True)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id", ondelete="RESTRICT"), nullable=True, index=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(20), default="low", index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft", index=True)
    rejection_reason: Mapped[str] = mapped_column(Text, default="")
    checkin_interval_minutes: Mapped[int] = mapped_column(Integer, default=120)
    last_checkin_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_checkin_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    vehicle: Mapped[Vehicle | None] = relationship()
    driver: Mapped[Driver | None] = relationship()
    requester: Mapped[User] = relationship(foreign_keys=[requester_id])
    approvals: Mapped[list[Approval]] = relationship(back_populates="journey", cascade="all, delete-orphan")
    risk_answers: Mapped[list[RiskAnswer]] = relationship(back_populates="journey", cascade="all, delete-orphan")
    checklist_answers: Mapped[list[ChecklistAnswer]] = relationship(back_populates="journey", cascade="all, delete-orphan")


class Approval(Base):
    __tablename__ = "approvals"
    __table_args__ = (UniqueConstraint("journey_id", "stage", name="uq_approval_stage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journey_id: Mapped[int] = mapped_column(ForeignKey("journeys.id", ondelete="CASCADE"), index=True)
    stage: Mapped[int] = mapped_column(Integer)
    required_role: Mapped[str] = mapped_column(String(40))
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    acted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    journey: Mapped[Journey] = relationship(back_populates="approvals")
    approver: Mapped[User | None] = relationship()


class RiskAnswer(Base):
    __tablename__ = "risk_answers"
    __table_args__ = (UniqueConstraint("journey_id", "question_key", name="uq_risk_answer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journey_id: Mapped[int] = mapped_column(ForeignKey("journeys.id", ondelete="CASCADE"), index=True)
    question_key: Mapped[str] = mapped_column(String(80))
    question_text: Mapped[str] = mapped_column(String(500))
    answer: Mapped[bool] = mapped_column(Boolean)
    weight: Mapped[int] = mapped_column(Integer)
    journey: Mapped[Journey] = relationship(back_populates="risk_answers")


class ChecklistAnswer(Base):
    __tablename__ = "checklist_answers"
    __table_args__ = (UniqueConstraint("journey_id", "item_key", name="uq_checklist_answer"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journey_id: Mapped[int] = mapped_column(ForeignKey("journeys.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(80))
    item_text: Mapped[str] = mapped_column(String(500))
    confirmed: Mapped[bool] = mapped_column(Boolean)
    journey: Mapped[Journey] = relationship(back_populates="checklist_answers")


class JourneyEvent(Base):
    __tablename__ = "journey_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journey_id: Mapped[int] = mapped_column(ForeignKey("journeys.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    message: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[User | None] = relationship()


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), default="info")
    journey_id: Mapped[int | None] = mapped_column(ForeignKey("journeys.id", ondelete="CASCADE"), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[str] = mapped_column(String(80), default="")
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    ip_address: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[User | None] = relationship()


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


Index("ix_journey_vehicle_window", Journey.vehicle_id, Journey.departure_at, Journey.estimated_arrival_at)
Index("ix_journey_driver_window", Journey.driver_id, Journey.departure_at, Journey.estimated_arrival_at)
