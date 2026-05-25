"""
services/logger.py — Structured logging for the AI platform

Logs every AI query with:
- user_query, generated_sql, execution_time_ms
- error_type, retry_count
- session_id, dataset_id

Writes to both console and logs/ai_queries.log
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path

# Create logs directory
Path("logs").mkdir(exist_ok=True)

# ── Formatter ─────────────────────────────────────────────────
class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "timestamp":  datetime.utcnow().isoformat(),
            "level":      record.levelname,
            "message":    record.getMessage(),
        }
        # Support both old {record.extra} and new {record.extra: {dict}} patterns
        if hasattr(record, "extra"):
            val = record.extra
            if isinstance(val, dict):
                log_data.update(val)
        return json.dumps(log_data)


# ── Setup logger ──────────────────────────────────────────────
def setup_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    if not logger.handlers:
        # Console handler
        console = logging.StreamHandler()
        console.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        ))
        logger.addHandler(console)

        # File handler — JSON format
        file_h = logging.FileHandler("logs/ai_queries.log", encoding="utf-8")
        file_h.setFormatter(JSONFormatter())
        logger.addHandler(file_h)

    return logger


# ── Module-level loggers ──────────────────────────────────────
ai_logger   = setup_logger("ai_pipeline")
auth_logger = setup_logger("auth")


# ── Convenience functions ─────────────────────────────────────

def log_query(
    user_query:        str,
    generated_sql:     str  = "",
    execution_time_ms: int  = 0,
    row_count:         int  = 0,
    sql_attempts:      int  = 1,
    error_type:        str  = "",
    error_msg:         str  = "",
    session_id:        str  = "",
    dataset_id:        str  = "",
    route:             str  = "sql",
) -> None:
    """
    Log a completed AI query with full context.
    FIX (LOW): replaced manual LogRecord construction with standard
    logger.info()/error() + extra= which respects level filters and
    is the documented pattern for structured logging in Python.
    """
    extra = {
        "event":             "ai_query",
        "user_query":        user_query[:200],
        "generated_sql":     generated_sql[:300] if generated_sql else "",
        "execution_time_ms": execution_time_ms,
        "row_count":         row_count,
        "sql_attempts":      sql_attempts,
        "error_type":        error_type,
        "error_msg":         error_msg[:200] if error_msg else "",
        "session_id":        session_id,
        "dataset_id":        dataset_id,
        "route":             route,
    }
    msg = f"AI query: {user_query[:80]}"
    if error_msg:
        ai_logger.error(msg, extra={"extra": extra})
    else:
        ai_logger.info(msg, extra={"extra": extra})


def log_auth_event(event: str, email: str, success: bool, detail: str = "") -> None:
    """Log auth events — signup, login, OTP attempts."""
    extra = {
        "event":   event,
        "email":   email,
        "success": success,
        "detail":  detail,
    }
    msg = f"Auth {event}: {email} — {'OK' if success else 'FAILED'}"
    if success:
        auth_logger.info(msg, extra={"extra": extra})
    else:
        auth_logger.warning(msg, extra={"extra": extra})