"""
schemas/whatsapp.py — Pydantic schemas for WhatsApp & Lead management
"""

from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Client (Business Owner) ──────────────────────────────────
class ClientCreate(BaseModel):
    business_name: str
    niche: str  # gym, coaching, clinic, realestate, d2c
    whatsapp_number: str
    document_id: Optional[str] = None  # FAQ PDF document

    @field_validator("business_name")
    @classmethod
    def name_valid(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Business name must be at least 2 characters")
        return v

    @field_validator("niche")
    @classmethod
    def niche_valid(cls, v):
        allowed = {"gym", "coaching", "clinic", "realestate", "d2c", "education", "event", "other"}
        if v.lower() not in allowed:
            raise ValueError(f"Niche must be one of: {', '.join(allowed)}")
        return v.lower()

    @field_validator("whatsapp_number")
    @classmethod
    def phone_valid(cls, v):
        v = v.strip().replace(" ", "").replace("-", "").replace("+", "")
        if not v.isdigit() or len(v) < 10:
            raise ValueError("Invalid phone number")
        return v


class ClientResponse(BaseModel):
    id: UUID
    business_name: str
    niche: str
    whatsapp_number: str
    document_id: Optional[UUID] = None
    greeting_message: Optional[str] = None
    is_active: bool
    lead_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class ClientUpdate(BaseModel):
    business_name: Optional[str] = None
    niche: Optional[str] = None
    greeting_message: Optional[str] = None
    document_id: Optional[str] = None
    is_active: Optional[bool] = None


# ── Lead ─────────────────────────────────────────────────────
class LeadResponse(BaseModel):
    id: UUID
    client_id: UUID
    phone: str
    name: Optional[str] = None
    interest: Optional[str] = None
    status: str
    source: str
    lead_score: Optional[int] = None
    message_count: int = 0
    created_at: datetime
    last_message_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    interest: Optional[str] = None
    status: Optional[str] = None
    lead_score: Optional[int] = None

    @field_validator("status")
    @classmethod
    def status_valid(cls, v):
        if v is None:
            return v
        allowed = {"new", "contacted", "qualified", "converted", "lost"}
        if v.lower() not in allowed:
            raise ValueError(f"Status must be one of: {', '.join(allowed)}")
        return v.lower()


# ── Lead Messages ────────────────────────────────────────────
class LeadMessageResponse(BaseModel):
    id: UUID
    lead_id: UUID
    direction: str  # inbound / outbound
    message_text: str
    message_type: str  # text / button_reply / image
    created_at: datetime

    class Config:
        from_attributes = True


# ── WhatsApp Webhook (internal) ──────────────────────────────
class WebhookMessage(BaseModel):
    """Parsed incoming WhatsApp message."""
    message_id: str
    from_phone: str
    timestamp: str
    message_type: str  # text, interactive, image, audio
    text: Optional[str] = None
    button_id: Optional[str] = None
    button_text: Optional[str] = None
    profile_name: Optional[str] = None


# ── Analytics ────────────────────────────────────────────────
class ClientAnalytics(BaseModel):
    total_leads: int
    new_leads_today: int
    new_leads_week: int
    leads_by_status: dict
    avg_response_time_seconds: Optional[float] = None
    conversion_rate: Optional[float] = None
    top_interests: List[dict] = []


# ── Generic ──────────────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str
