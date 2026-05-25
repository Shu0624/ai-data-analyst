import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, Integer, Float, ForeignKey, TIMESTAMP
from sqlalchemy.orm import relationship
from database import Base, DATABASE_URL

import os
from sqlalchemy.dialects.postgresql import UUID as pgUUID, JSONB as pgJSONB

# Conditionally map UUID and JSONB to support SQLite in local offline mode
if DATABASE_URL and DATABASE_URL.startswith("postgresql"):
    UUID = pgUUID
    JSONB = pgJSONB
else:
    from sqlalchemy.types import TypeDecorator, String as SQLiteString
    from sqlalchemy import JSON as SQLiteJSON
    class SQLiteUUID(TypeDecorator):
        impl = SQLiteString
        cache_ok = True
        
        def __init__(self, length=36, *args, **kwargs):
            kwargs.pop("as_uuid", None)
            super().__init__(length, *args, **kwargs)

        def process_bind_param(self, value, dialect):
            if value is None:
                return None
            if isinstance(value, uuid.UUID):
                return str(value)
            return str(value)

        def process_result_value(self, value, dialect):
            if value is None:
                return None
            try:
                return uuid.UUID(value)
            except ValueError:
                return value
    UUID = SQLiteUUID
    JSONB = SQLiteJSON


def now():
    return datetime.utcnow()


# ── 1. Users ──────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name          = Column(String(100), nullable=False)
    email         = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(String(20),  nullable=False, default="user")
    is_verified   = Column(Boolean,     nullable=False, default=False)

    # OTP — stored as bcrypt hash, never plaintext
    otp_hash       = Column(String(255), nullable=True)
    otp_expires_at = Column(TIMESTAMP,   nullable=True)
    otp_created_at = Column(TIMESTAMP,   nullable=True)
    otp_purpose    = Column(String(20),  nullable=True)  # "verify_email" | "reset_password"
    otp_attempts   = Column(Integer,     nullable=False, default=0)

    created_at    = Column(TIMESTAMP, nullable=False, default=now)
    updated_at    = Column(TIMESTAMP, nullable=False, default=now, onupdate=now)

    profile        = relationship("UserProfile",  back_populates="user", uselist=False, cascade="all, delete")
    datasets       = relationship("Dataset",      back_populates="user", cascade="all, delete")
    chat_sessions  = relationship("ChatSession",  back_populates="user", cascade="all, delete")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete")
    documents      = relationship("Document",     back_populates="user", cascade="all, delete")


# ── 1b. Refresh Tokens ────────────────────────────────────────
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    expires_at = Column(TIMESTAMP,   nullable=False)
    revoked    = Column(Boolean,     nullable=False, default=False)
    created_at = Column(TIMESTAMP,   nullable=False, default=now)

    user = relationship("User", back_populates="refresh_tokens")


# ── 2. User Profiles ──────────────────────────────────────────
class UserProfile(Base):
    __tablename__ = "user_profiles"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id          = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_name     = Column(String(150))
    industry         = Column(String(100))
    experience_level = Column(String(50))
    created_at       = Column(TIMESTAMP, nullable=False, default=now)

    user = relationship("User", back_populates="profile")


# ── 3. Datasets ───────────────────────────────────────────────
class Dataset(Base):
    __tablename__ = "datasets"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id             = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    dataset_name        = Column(String(200), nullable=False)
    dataset_type        = Column(String(20),  nullable=False)
    file_path           = Column(Text)
    database_connection = Column(JSONB)
    description         = Column(Text)
    suggested_questions = Column(JSONB, nullable=True)
    created_at          = Column(TIMESTAMP, nullable=False, default=now)

    user          = relationship("User",         back_populates="datasets")
    tables        = relationship("DatasetTable", back_populates="dataset", cascade="all, delete")
    chat_sessions = relationship("ChatSession",  back_populates="dataset")


# ── 4. Dataset Tables ─────────────────────────────────────────
class DatasetTable(Base):
    __tablename__ = "dataset_tables"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    table_name = Column(String(200), nullable=False)
    row_count  = Column(Integer)
    created_at = Column(TIMESTAMP, nullable=False, default=now)

    dataset = relationship("Dataset",       back_populates="tables")
    columns = relationship("DatasetColumn", back_populates="table", cascade="all, delete")


# ── 5. Dataset Columns ────────────────────────────────────────
class DatasetColumn(Base):
    __tablename__ = "dataset_columns"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    table_id      = Column(UUID(as_uuid=True), ForeignKey("dataset_tables.id", ondelete="CASCADE"), nullable=False)
    column_name   = Column(String(200), nullable=False)
    data_type     = Column(String(100), nullable=False)
    is_nullable   = Column(Boolean, nullable=False, default=True)
    sample_values = Column(Text, nullable=True)
    created_at    = Column(TIMESTAMP, nullable=False, default=now)

    table = relationship("DatasetTable", back_populates="columns")


# ── 6. Chat Sessions ──────────────────────────────────────────
class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    dataset_id    = Column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    session_name  = Column(String(200))
    created_at    = Column(TIMESTAMP, nullable=False, default=now)
    last_activity = Column(TIMESTAMP, nullable=False, default=now)

    user     = relationship("User",        back_populates="chat_sessions")
    dataset  = relationship("Dataset",     back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete")
    queries  = relationship("AIQuery",     back_populates="session", cascade="all, delete")


# ── 7. Chat Messages ──────────────────────────────────────────
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id   = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role         = Column(String(20), nullable=False)
    message_text = Column(Text, nullable=False)
    created_at   = Column(TIMESTAMP, nullable=False, default=now)

    session = relationship("ChatSession", back_populates="messages")


# ── 8. AI Queries ─────────────────────────────────────────────
class AIQuery(Base):
    __tablename__ = "ai_queries"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id        = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    user_query        = Column(Text, nullable=False)
    generated_sql     = Column(Text)
    sql_valid         = Column(Boolean)
    execution_time_ms = Column(Integer)
    created_at        = Column(TIMESTAMP, nullable=False, default=now)

    session         = relationship("ChatSession",    back_populates="queries")
    result          = relationship("QueryResult",    back_populates="query", uselist=False, cascade="all, delete")
    visualizations  = relationship("Visualization",  back_populates="query", cascade="all, delete")
    insights        = relationship("Insight",        back_populates="query", cascade="all, delete")
    recommendations = relationship("Recommendation", back_populates="query", cascade="all, delete")


# ── 9. Query Results ──────────────────────────────────────────
class QueryResult(Base):
    __tablename__ = "query_results"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    query_id         = Column(UUID(as_uuid=True), ForeignKey("ai_queries.id", ondelete="CASCADE"), nullable=False)
    result_row_count = Column(Integer)
    result_preview   = Column(JSONB)
    created_at       = Column(TIMESTAMP, nullable=False, default=now)

    query = relationship("AIQuery", back_populates="result")


# ── 10. Visualizations ───────────────────────────────────────
class Visualization(Base):
    __tablename__ = "visualizations"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    query_id     = Column(UUID(as_uuid=True), ForeignKey("ai_queries.id", ondelete="CASCADE"), nullable=False)
    chart_type   = Column(String(50), nullable=False)
    chart_config = Column(JSONB, nullable=False)
    created_at   = Column(TIMESTAMP, nullable=False, default=now)

    query = relationship("AIQuery", back_populates="visualizations")


# ── 11. Insights ─────────────────────────────────────────────
class Insight(Base):
    __tablename__ = "insights"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    query_id         = Column(UUID(as_uuid=True), ForeignKey("ai_queries.id", ondelete="CASCADE"), nullable=False)
    insight_text     = Column(Text, nullable=False)
    importance_score = Column(Float)
    created_at       = Column(TIMESTAMP, nullable=False, default=now)

    query = relationship("AIQuery", back_populates="insights")


# ── 12. Recommendations ──────────────────────────────────────
class Recommendation(Base):
    __tablename__ = "recommendations"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    query_id            = Column(UUID(as_uuid=True), ForeignKey("ai_queries.id", ondelete="CASCADE"), nullable=False)
    recommendation_text = Column(Text, nullable=False)
    confidence_score    = Column(Float)
    created_at          = Column(TIMESTAMP, nullable=False, default=now)

    query = relationship("AIQuery", back_populates="recommendations")


# ── 13. Documents (PageIndex) ────────────────────────────────
class Document(Base):
    __tablename__ = "documents"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_name = Column(String(200), nullable=False)
    file_path     = Column(Text, nullable=False)
    page_count    = Column(Integer)
    tree_index    = Column(JSONB)                     # PageIndex tree structure
    status        = Column(String(20), nullable=False, default="processing")  # processing | ready | failed
    error_message = Column(Text, nullable=True)
    created_at    = Column(TIMESTAMP, nullable=False, default=now)

    user    = relationship("User",          back_populates="documents")
    queries = relationship("DocumentQuery", back_populates="document", cascade="all, delete")


# ── 14. Document Queries (Q&A) ───────────────────────────────
class DocumentQuery(Base):
    __tablename__ = "document_queries"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id      = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    user_query       = Column(Text, nullable=False)
    retrieved_pages  = Column(JSONB)                  # pages found via tree search
    answer           = Column(Text)
    confidence_score = Column(Float, nullable=True)
    created_at       = Column(TIMESTAMP, nullable=False, default=now)

    document = relationship("Document", back_populates="queries")


# ── 15. Clients (WhatsApp Business Owners) ───────────────────
class Client(Base):
    __tablename__ = "clients"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id           = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    business_name     = Column(String(200), nullable=False)
    niche             = Column(String(50),  nullable=False)   # gym | coaching | clinic | realestate | d2c | other
    whatsapp_number   = Column(String(20),  nullable=False, unique=True)
    document_id       = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    greeting_message  = Column(Text, nullable=True)           # Custom greeting when customer says "Hi"
    qualification_flow = Column(JSONB, nullable=True)         # Chatbot flow config
    is_active         = Column(Boolean, nullable=False, default=True)
    created_at        = Column(TIMESTAMP, nullable=False, default=now)
    updated_at        = Column(TIMESTAMP, nullable=False, default=now, onupdate=now)

    user     = relationship("User")
    document = relationship("Document")
    leads    = relationship("Lead", back_populates="client", cascade="all, delete")


# ── 16. Leads (Captured from WhatsApp) ───────────────────────
class Lead(Base):
    __tablename__ = "leads"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id       = Column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    phone           = Column(String(20),  nullable=False)
    name            = Column(String(100), nullable=True)
    interest        = Column(String(100), nullable=True)
    status          = Column(String(20),  nullable=False, default="new")  # new | contacted | qualified | converted | lost
    source          = Column(String(50),  nullable=False, default="whatsapp")
    lead_score      = Column(Integer, nullable=True)          # 0-100 AI-generated score
    last_message_at = Column(TIMESTAMP, nullable=True)
    created_at      = Column(TIMESTAMP, nullable=False, default=now)

    client   = relationship("Client",      back_populates="leads")
    messages = relationship("LeadMessage", back_populates="lead", cascade="all, delete")


# ── 17. Lead Messages (WhatsApp Conversation Log) ────────────
class LeadMessage(Base):
    __tablename__ = "lead_messages"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id      = Column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    direction    = Column(String(10),  nullable=False)    # inbound | outbound
    message_text = Column(Text,        nullable=False)
    message_type = Column(String(20),  nullable=False, default="text")  # text | button_reply | image | template
    wa_message_id = Column(String(100), nullable=True)    # WhatsApp message ID for tracking
    created_at   = Column(TIMESTAMP,   nullable=False, default=now)

    lead = relationship("Lead", back_populates="messages")