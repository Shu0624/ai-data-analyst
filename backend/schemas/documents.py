from pydantic import BaseModel, field_validator
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime


# ── Upload Response ───────────────────────────────────────────
class DocumentUploadResponse(BaseModel):
    message:       str
    document_id:   UUID
    document_name: str
    status:        str
    page_count:    Optional[int] = None
    tree_index:    Optional[Any] = None

    class Config:
        from_attributes = True


# ── Document Summary (list view) ─────────────────────────────
class DocumentSummaryResponse(BaseModel):
    id:            UUID
    document_name: str
    page_count:    Optional[int] = None
    status:        str
    query_count:   int = 0
    created_at:    datetime

    class Config:
        from_attributes = True


# ── Document Detail ───────────────────────────────────────────
class DocumentDetailResponse(BaseModel):
    id:            UUID
    document_name: str
    page_count:    Optional[int] = None
    status:        str
    error_message: Optional[str] = None
    tree_index:    Optional[Any] = None
    created_at:    datetime

    class Config:
        from_attributes = True


# ── Ask Request ───────────────────────────────────────────────
class DocumentAskRequest(BaseModel):
    document_id: str
    question:    str

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Question cannot be empty")
        if len(v.strip()) > 2000:
            raise ValueError("Question too long (max 2000 characters)")
        return v.strip()


# ── Ask Response ──────────────────────────────────────────────
class DocumentAskResponse(BaseModel):
    question:         str
    answer:           str
    retrieved_pages:  Optional[List[dict]] = None
    confidence_score: Optional[float]      = None


# ── Query History ─────────────────────────────────────────────
class DocumentQueryResponse(BaseModel):
    id:               UUID
    user_query:       str
    answer:           Optional[str]        = None
    retrieved_pages:  Optional[List[dict]] = None
    confidence_score: Optional[float]      = None
    created_at:       datetime

    class Config:
        from_attributes = True


# ── Generic Message ───────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str
