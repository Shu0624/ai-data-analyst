from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Create Session ────────────────────────────────────────────
class CreateSessionRequest(BaseModel):
    session_name: Optional[str] = None
    dataset_id:   Optional[str] = None

    @field_validator("session_name")
    @classmethod
    def name_valid(cls, v):
        if v is not None:
            v = v.strip()
            if len(v) < 1:
                raise ValueError("Session name cannot be empty")
            if len(v) > 200:
                raise ValueError("Session name too long (max 200 characters)")
        return v


# ── Send Message ──────────────────────────────────────────────
class SendMessageRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def message_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Message cannot be empty")
        if len(v.strip()) > 5000:
            raise ValueError("Message too long (max 5000 characters)")
        return v.strip()


# ── Single Message Response ───────────────────────────────────
class MessageResponse(BaseModel):
    id:           UUID
    session_id:   UUID
    role:         str
    message_text: str
    created_at:   datetime

    class Config:
        from_attributes = True


# ── Chat Reply (user message + AI response together) ─────────
class ChatReplyResponse(BaseModel):
    user_message: MessageResponse
    ai_message:   MessageResponse


# ── Session Summary (for list view) ──────────────────────────
class SessionSummaryResponse(BaseModel):
    id:            UUID
    session_name:  Optional[str]
    dataset_id:    Optional[UUID]
    dataset_name:  Optional[str]
    message_count: int
    created_at:    datetime
    last_activity: datetime

    class Config:
        from_attributes = True


# ── Session Detail (with full message history) ────────────────
class SessionDetailResponse(BaseModel):
    id:            UUID
    session_name:  Optional[str]
    dataset_id:    Optional[UUID]
    dataset_name:  Optional[str]
    messages:      List[MessageResponse] = []
    created_at:    datetime
    last_activity: datetime

    class Config:
        from_attributes = True


# ── Generic Message ───────────────────────────────────────────
class GenericMessageResponse(BaseModel):
    message: str