from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator

RoleName = Literal["admin", "control", "approver", "hse", "creator", "viewer"]


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=300)
    otp: str | None = Field(default=None, max_length=40)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=40)


class MfaDisableIn(BaseModel):
    password: str
    code: str = Field(min_length=6, max_length=40)


class UserCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    title: str = Field(default="", max_length=160)
    division: str = Field(default="All Divisions", max_length=160)
    role: RoleName = "viewer"
    password: str
    active: bool = True
    must_change_password: bool = True


class UserUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    title: str | None = Field(default=None, max_length=160)
    division: str | None = Field(default=None, max_length=160)
    role: RoleName | None = None
    active: bool | None = None


class PasswordResetIn(BaseModel):
    new_password: str
    must_change_password: bool = True


from pydantic import BaseModel, Field, field_validator
from typing import Literal
from datetime import date

class VehicleIn(BaseModel):
    plate: str = Field(min_length=2, max_length=50)
    model: str = Field(default="", max_length=160)
    contractor: str = Field(default="", max_length=160)
    vehicle_type: str = Field(default="Light", max_length=80)
    license_expiry: date | None = None
    insurance_expiry: date | None = None
    inspection_expiry: date | None = None
    maintenance_due: date | None = None
    gps_status: Literal["Active", "Inactive", "N/A"] = "Active"
    status: Literal["active", "maintenance", "blacklisted"] = "active"
    notes: str = Field(default="", max_length=2000)
    version: int | None = None

    @field_validator("status", mode="before")
    def normalize_status(cls, v: str) -> str:
        if isinstance(v, str):
            return v.lower()
        return v

class DriverIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    phone: str = Field(default="", max_length=80)
    license_class: str = Field(default="Class 1", max_length=80)
    license_expiry: date | None = None
    ddc_expiry: date | None = None
    medical_expiry: date | None = None
    defensive_expiry: date | None = None
    drug_test: Literal["Clear", "Pending", "Failed"] = "Clear"
    rest_hours: float = Field(default=8, ge=0, le=48)
    status: Literal["active", "restricted"] = "active"
    notes: str = Field(default="", max_length=2000)
    version: int | None = None


class RiskAnswerIn(BaseModel):
    question_key: str = Field(min_length=1, max_length=80)
    answer: bool


class ChecklistAnswerIn(BaseModel):
    item_key: str = Field(min_length=1, max_length=80)
    confirmed: bool


class JourneyCreateIn(BaseModel):
    division: str = Field(min_length=1, max_length=160)
    site: str = Field(default="", max_length=160)
    purpose: str = Field(default="", max_length=3000)
    start_location: str = Field(min_length=1, max_length=220)
    end_location: str = Field(min_length=1, max_length=220)
    departure_at: datetime
    estimated_arrival_at: datetime
    distance_km: float = Field(gt=0, le=10000)
    night_drive: bool = False
    load_type: Literal["Passengers", "Equipment", "Mixed", "Dangerous Goods"] = "Passengers"
    passengers: str = Field(default="", max_length=3000)
    vehicle_id: int | None = None
    driver_id: int | None = None
    risk_answers: list[RiskAnswerIn] = []
    checklist_answers: list[ChecklistAnswerIn] = []
    submit: bool = False

    @model_validator(mode="after")
    def validate_times(self):
        if self.estimated_arrival_at <= self.departure_at:
            raise ValueError("Estimated arrival must be after departure.")
        return self


class JourneyUpdateIn(JourneyCreateIn):
    version: int


class DecisionIn(BaseModel):
    comment: str = Field(default="", max_length=2000)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class TransitionIn(BaseModel):
    status: Literal["departed", "arrived", "closed", "suspended", "cancelled", "approved"]
    comment: str = Field(default="", max_length=2000)


class CheckinIn(BaseModel):
    comment: str = Field(default="Driver confirmed safe and on route", max_length=2000)
    location: str = Field(default="", max_length=300)


class SettingsIn(BaseModel):
    workspace_name: str = Field(default="Moveintrack", max_length=160)
    company_code: str = Field(default="MIT", min_length=2, max_length=10)
    support_email: str = Field(default="", max_length=255)
    timezone: str = Field(default="Africa/Cairo", max_length=80)
    low_checkin_minutes: int = Field(default=120, ge=15, le=1440)
    medium_checkin_minutes: int = Field(default=60, ge=15, le=1440)
    high_checkin_minutes: int = Field(default=30, ge=10, le=1440)
    minimum_rest_hours: int = Field(default=8, ge=4, le=24)
    require_gps: bool = True
    document_warning_days: int = Field(default=30, ge=1, le=365)
    require_mfa: bool = False
