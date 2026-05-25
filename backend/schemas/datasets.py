from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Connect External Database ─────────────────────────────────
class ConnectDatabaseRequest(BaseModel):
    dataset_name: str
    description:  Optional[str] = None
    db_type:      str
    host:         str
    port:         int
    username:     str
    password:     str
    database:     str

    @field_validator("dataset_name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Dataset name cannot be empty")
        return v.strip()

    @field_validator("db_type")
    @classmethod
    def db_type_valid(cls, v):
        allowed = ("postgresql", "mysql")
        if v.lower() not in allowed:
            raise ValueError(f"db_type must be one of: {', '.join(allowed)}")
        return v.lower()

    @field_validator("port")
    @classmethod
    def port_valid(cls, v):
        if not (1 <= v <= 65535):
            raise ValueError("Port must be between 1 and 65535")
        return v


# ── Column Response ───────────────────────────────────────────
class ColumnResponse(BaseModel):
    id:          UUID
    column_name: str
    data_type:   str
    is_nullable: bool

    class Config:
        from_attributes = True


# ── Table Response ────────────────────────────────────────────
class TableResponse(BaseModel):
    id:         UUID
    table_name: str
    row_count:  Optional[int]
    columns:    List[ColumnResponse] = []

    class Config:
        from_attributes = True


# ── Dataset List Item ─────────────────────────────────────────
class DatasetSummaryResponse(BaseModel):
    id:           UUID
    dataset_name: str
    dataset_type: str
    description:  Optional[str]
    created_at:   datetime
    table_count:  int
    total_rows:   int

    class Config:
        from_attributes = True


# ── Dataset Full Detail ───────────────────────────────────────
class DatasetDetailResponse(BaseModel):
    id:           UUID
    dataset_name: str
    dataset_type: str
    description:  Optional[str]
    created_at:   datetime
    tables:       List[TableResponse] = []

    class Config:
        from_attributes = True


# ── Upload Success ────────────────────────────────────────────
class UploadSuccessResponse(BaseModel):
    message:              str
    dataset_id:           UUID
    tables:               List[TableResponse]    = []
    profile:              Optional[dict]         = None
    suggested_questions:  Optional[List[str]]    = None


# ── Generic Message ───────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str