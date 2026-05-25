from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from uuid import UUID
from datetime import datetime


# ── Update User Basic Info ────────────────────────────────────
class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, v):
        if v is not None:
            if not v.strip():
                raise ValueError("Name cannot be empty")
            if len(v.strip()) < 2:
                raise ValueError("Name must be at least 2 characters")
            return v.strip()
        return v


# ── Update User Profile (company/industry/experience) ─────────
class UpdateProfileRequest(BaseModel):
    company_name:     Optional[str] = None
    industry:         Optional[str] = None
    experience_level: Optional[str] = None

    @field_validator("experience_level")
    @classmethod
    def experience_valid(cls, v):
        allowed = ("beginner", "intermediate", "advanced", "expert")
        if v is not None and v.lower() not in allowed:
            raise ValueError(f"experience_level must be one of: {', '.join(allowed)}")
        return v.lower() if v else v


# ── Response: User Profile (nested) ──────────────────────────
class UserProfileResponse(BaseModel):
    company_name:     Optional[str]
    industry:         Optional[str]
    experience_level: Optional[str]

    class Config:
        from_attributes = True


# ── Response: Full User with Profile ─────────────────────────
class FullUserResponse(BaseModel):
    id:         UUID
    name:       str
    email:      str
    role:       str
    created_at: datetime
    updated_at: datetime
    profile:    Optional[UserProfileResponse] = None

    class Config:
        from_attributes = True


# ── Response: Dashboard Summary ───────────────────────────────
class DashboardSummaryResponse(BaseModel):
    total_datasets:     int
    total_sessions:     int
    total_queries:      int
    recent_session_name: Optional[str]
    recent_session_date: Optional[datetime]


# ── Generic Message ───────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str