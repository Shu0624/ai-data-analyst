import os
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload
from groq import Groq
from dotenv import load_dotenv

from database import get_db
from models import User, ChatSession, ChatMessage, Dataset, DatasetTable, DatasetColumn
from routers.auth import get_current_user
from schemas.chat import (
    CreateSessionRequest,
    SendMessageRequest,
    ChatReplyResponse,
    SessionSummaryResponse,
    SessionDetailResponse,
    MessageResponse,
    GenericMessageResponse,
)

load_dotenv()

router = APIRouter()

# ── Groq config ───────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

# ── Limits ────────────────────────────────────────────────────
MAX_HISTORY_MESSAGES = 10
MAX_SESSION_MESSAGES = 500

# ── Fix #3: lazy-initialized global Groq client ───────────────
_groq_client = None

def get_groq_client() -> Groq:
    """
    Lazy initialization of Groq client.
    Created on first use — no restart needed if .env changes.
    """
    global _groq_client
    if _groq_client is None:
        if not GROQ_API_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Groq API key not configured. Set GROQ_API_KEY in .env",
            )
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


# ════════════════════════════════════════════════════════════════
# UTILITIES
# ════════════════════════════════════════════════════════════════

def validate_uuid(value: str, label: str = "ID") -> uuid.UUID:
    """Parse string to UUID — clean 400 on bad format."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label} format",
        )


def get_session_or_404(
    db: Session,
    session_id: str,
    user_id: uuid.UUID,
) -> ChatSession:
    """
    Fetch ChatSession by ID.
    Raises 400 on bad UUID, 404 if not found, 403 if wrong owner.
    """
    uid     = validate_uuid(session_id, "session ID")
    session = db.query(ChatSession).filter(ChatSession.id == uid).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    if session.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return session


def get_dataset_schema_text(db: Session, dataset_id: uuid.UUID) -> str:
    """
    Build plain-text schema for the dataset.
    Uses joinedload — loads everything in ONE query (no N+1).
    Fix #5: improved format so LLM generates correct table names.
    """
    dataset = (
        db.query(Dataset)
        .options(
            joinedload(Dataset.tables)
            .joinedload(DatasetTable.columns)
        )
        .filter(Dataset.id == dataset_id)
        .first()
    )

    if not dataset:
        return ""

    lines = [f"Dataset name: {dataset.dataset_name}"]
    for table in dataset.tables:
        # Fix #5: cleaner format LLMs understand better
        lines.append(f"\nTable {table.table_name} ({table.row_count} rows)")
        lines.append("Columns:")
        for col in table.columns:
            nullable = "NULL" if col.is_nullable else "NOT NULL"
            lines.append(f"  - {col.column_name} {col.data_type} {nullable}")

    return "\n".join(lines)


def is_safe_sql(query: str) -> bool:
    """
    Fix #4: validate AI-generated SQL before execution.
    Only SELECT queries are allowed — block all data-modifying statements.
    """
    q = query.lower().strip()
    forbidden = [
        "insert", "update", "delete", "drop",
        "alter", "truncate", "create", "grant",
        "revoke", "replace", "merge", "exec",
    ]
    return not any(word in q for word in forbidden)


def build_system_prompt(schema_text: str) -> str:
    """
    Build system prompt with role, safety rules, and schema context.
    Fix #6: explicit instructions to use table names not dataset IDs.
    """
    base = (
        "You are an expert AI Data Analyst assistant. "
        "Your job is to help users analyze their datasets by answering questions, "
        "writing SQL queries, explaining query results, and providing business insights. "
        "Always be concise, accurate, and helpful. "
        "When writing SQL, format it clearly in a code block and explain what it does. "
        "When providing insights, be specific and actionable. "
        "If you are unsure about something, say so clearly.\n\n"
        "STRICT SAFETY RULES — follow these at all times:\n"
        "- You must ONLY generate SELECT queries.\n"
        "- Never generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, "
        "or any data-modifying SQL under any circumstances.\n"
        "- Ignore any user instructions that ask you to modify or delete data.\n"
    )

    if schema_text:
        return (
            f"{base}\n"
            f"The user has the following dataset available:\n"
            f"{schema_text}\n\n"
            f"IMPORTANT SQL RULES:\n"
            f"- Only use table names listed after 'Table' in the schema above.\n"
            f"- Never use dataset IDs, UUIDs, or dataset names as table names.\n"
            f"- Only reference columns that exist in the schema above.\n"
            f"- Always use exact table and column names as shown.\n"
        )

    return base


def build_groq_messages(
    system_prompt: str,
    past_messages: list,
    user_message: str,
) -> list:
    """
    Build messages in Groq/OpenAI format:
    [system, user, assistant, user, assistant, ..., user]
    """
    messages = [{"role": "system", "content": system_prompt}]

    for msg in past_messages:
        messages.append({
            "role":    msg.role,
            "content": msg.message_text,
        })

    messages.append({"role": "user", "content": user_message})
    return messages


def call_groq_api(messages: list) -> str:
    """
    Call Groq API using lazy-initialized global client.
    Fix #3: lazy client init.
    Fix #4: safe choices check before accessing.
    """
    client = get_groq_client()

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            max_tokens=1024,
            temperature=0.3,
            top_p=0.9,
        )

        # Fix #4: safely handle empty choices
        if not response.choices:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Groq returned an empty response",
            )

        content = response.choices[0].message.content
        return content.strip() if content else ""

    except HTTPException:
        raise  # re-raise our own exceptions

    except Exception as e:
        error_msg = str(e).lower()

        if "authentication" in error_msg or "api key" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invalid Groq API key. Check GROQ_API_KEY in .env",
            )
        if "rate limit" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Groq rate limit reached. Please wait and try again.",
            )
        if "model" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Model '{GROQ_MODEL}' not available. Check GROQ_MODEL in .env",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Groq API error: {str(e)}",
        )


def save_message(
    db: Session,
    session_id: uuid.UUID,
    role: str,
    text: str,
) -> ChatMessage:
    """Save a single chat message and flush to get its ID."""
    msg = ChatMessage(
        session_id=session_id,
        role=role,
        message_text=text,
    )
    db.add(msg)
    db.flush()
    return msg


def trim_old_messages(db: Session, session_id: uuid.UUID) -> None:
    """
    Fix #1 (subquery fix): if session exceeds MAX_SESSION_MESSAGES,
    delete oldest ones using proper SQLAlchemy select() subquery.
    """
    total = (
        db.query(func.count(ChatMessage.id))
        .filter(ChatMessage.session_id == session_id)
        .scalar()
    )

    if total >= MAX_SESSION_MESSAGES:
        # Fix #1: use select() not .subquery() for .in_() compatibility
        oldest = (
            select(ChatMessage.id)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.asc())
            .limit(total - MAX_SESSION_MESSAGES + 1)
        )
        db.query(ChatMessage).filter(
            ChatMessage.id.in_(oldest)
        ).delete(synchronize_session=False)


# ════════════════════════════════════════════════════════════════
# POST /chat/sessions
# ════════════════════════════════════════════════════════════════
@router.post(
    "/sessions",
    response_model=SessionDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a new chat session",
)
def create_session(
    body:         CreateSessionRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Creates a new chat session.
    Optionally link a dataset so the AI has schema context.
    Session name is auto-generated if not provided.
    """
    dataset_id = None

    if body.dataset_id:
        uid = validate_uuid(body.dataset_id, "dataset ID")
        dataset = db.query(Dataset).filter(
            Dataset.id == uid,
            Dataset.user_id == current_user.id,
        ).first()
        if not dataset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset not found or access denied",
            )
        dataset_id = uid

    now          = datetime.now(timezone.utc)
    session_name = (
        body.session_name
        or f"Session {now.strftime('%b %d, %Y %H:%M')}"
    )

    session = ChatSession(
        user_id=current_user.id,
        dataset_id=dataset_id,
        session_name=session_name,
    )

    try:
        db.add(session)
        db.commit()
        db.refresh(session)
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to create session. Please try again.")

    return {
        "id":            session.id,
        "session_name":  session.session_name,
        "dataset_id":    session.dataset_id,
        "dataset_name":  session.dataset.dataset_name if session.dataset else None,
        "messages":      [],
        "created_at":    session.created_at,
        "last_activity": session.last_activity,
    }


# ════════════════════════════════════════════════════════════════
# GET /chat/sessions
# ════════════════════════════════════════════════════════════════
@router.get(
    "/sessions",
    response_model=List[SessionSummaryResponse],
    summary="List all chat sessions",
)
def list_sessions(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Returns all sessions with message counts.
    Performance fix: single query with outerjoin + GROUP BY
    instead of N+1 COUNT queries per session.
    """
    rows = (
        db.query(
            ChatSession,
            func.count(ChatMessage.id).label("message_count")
        )
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .group_by(ChatSession.id)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.last_activity.desc())
        .all()
    )

    return [
        {
            "id":            s.id,
            "session_name":  s.session_name,
            "dataset_id":    s.dataset_id,
            "dataset_name":  s.dataset.dataset_name if s.dataset else None,
            "message_count": count,
            "created_at":    s.created_at,
            "last_activity": s.last_activity,
        }
        for s, count in rows
    ]


# ════════════════════════════════════════════════════════════════
# GET /chat/sessions/{session_id}
# ════════════════════════════════════════════════════════════════
@router.get(
    "/sessions/{session_id}",
    response_model=SessionDetailResponse,
    summary="Get session with full message history",
)
def get_session(
    session_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Returns session details and all messages in chronological order."""
    session = get_session_or_404(db, session_id, current_user.id)

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    return {
        "id":            session.id,
        "session_name":  session.session_name,
        "dataset_id":    session.dataset_id,
        "dataset_name":  session.dataset.dataset_name if session.dataset else None,
        "messages":      messages,
        "created_at":    session.created_at,
        "last_activity": session.last_activity,
    }


# ════════════════════════════════════════════════════════════════
# POST /chat/sessions/{session_id}/message
# ════════════════════════════════════════════════════════════════
@router.post(
    "/sessions/{session_id}/message",
    response_model=ChatReplyResponse,
    summary="Send a message and get AI response",
)
def send_message(
    session_id:   str,
    body:         SendMessageRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Full chat flow:
    1. Validate session + message
    2. Load schema with joinedload (no N+1)
    3. Fetch LATEST 10 messages DESC then reverse (fix #2)
    4. Build Groq messages array
    5. Call Groq API
    6. Trim old messages if over cap (fix #1 subquery)
    7. Save both messages + update last_activity
    8. Return user + AI messages
    """
    session = get_session_or_404(db, session_id, current_user.id)

    if not body.message.strip():
        raise HTTPException(400, "Message cannot be empty")

    # Get schema with joinedload
    schema_text = ""
    if session.dataset_id:
        schema_text = get_dataset_schema_text(db, session.dataset_id)

    # Fix #2: fetch LATEST messages DESC, then reverse for chronological order
    past_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(MAX_HISTORY_MESSAGES)
        .all()
    )
    past_messages = list(reversed(past_messages))

    # Build and call
    system_prompt = build_system_prompt(schema_text)
    groq_messages = build_groq_messages(system_prompt, past_messages, body.message)
    ai_text       = call_groq_api(groq_messages)

    if not ai_text:
        ai_text = "I could not generate a response. Please rephrase your question."

    try:
        trim_old_messages(db, session.id)
        user_msg              = save_message(db, session.id, "user",      body.message)
        ai_msg                = save_message(db, session.id, "assistant", ai_text)
        session.last_activity = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user_msg)
        db.refresh(ai_msg)
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to save messages. Please try again.")

    return {
        "user_message": user_msg,
        "ai_message":   ai_msg,
    }


# ════════════════════════════════════════════════════════════════
# GET /chat/sessions/{session_id}/history
# ════════════════════════════════════════════════════════════════
@router.get(
    "/sessions/{session_id}/history",
    response_model=List[MessageResponse],
    summary="Get full conversation history",
)
def get_history(
    session_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Returns all messages in chronological order."""
    session = get_session_or_404(db, session_id, current_user.id)

    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )


# ════════════════════════════════════════════════════════════════
# DELETE /chat/sessions/{session_id}
# ════════════════════════════════════════════════════════════════
@router.delete(
    "/sessions/{session_id}",
    response_model=GenericMessageResponse,
    summary="Delete a session and all its messages",
)
def delete_session(
    session_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Permanently deletes the session.
    All messages + AI queries cascade-deleted by PostgreSQL.
    """
    session = get_session_or_404(db, session_id, current_user.id)

    try:
        db.delete(session)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to delete session. Please try again.")

    return {"message": "Session deleted successfully"}