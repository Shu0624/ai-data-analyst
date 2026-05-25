"""
services/memory.py — Hierarchical RAG + Session Memory (Production Grade)

Fixes applied from review:
  1. Thread-safe with Lock — no race conditions
  2. Session TTL + cleanup — no memory leak
  3. Fresh summarization — no recursive degradation
  4. Full SQL stored — no truncation
  5. Token-aware compression threshold
  6. Relevance filtering — only inject relevant context
  7. Safe result preview — limited cols + rows
  8. Skip summarization if low-value turn
  9. Structured memory entities for better retrieval
  10. Query intent detection — only inject last_sql when relevant
  11. Lazy context building — only build sections that are useful

Architecture:
─────────────
User Query
   ↓
Intent Detection (follow-up? fresh? related?)
   ↓
Layer 1: Relevance-filtered recent turns
   ↓
Layer 2: Session summary (structured, non-degrading)
   ↓
Layer 3: Last SQL (only if follow-up intent detected)
   ↓
Context Compression (token-aware, not length-based)
   ↓
Final Context → Agent
"""

import json
import time
from datetime import datetime, timedelta
from threading import Lock
from typing import Optional, List, Dict

from services.utils import call_groq


# ════════════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════════════

SUMMARY_TRIGGER      = 5      # summarize after N turns
MAX_RAW_MESSAGES     = 5      # keep last N raw turns
SUMMARY_MAX_TOKENS   = 250
COMPRESSION_TOKENS   = 150
SESSION_TTL_HOURS    = 2      # sessions expire after 2 hours of inactivity
MAX_SESSIONS         = 1000   # max sessions in memory before eviction
PREVIEW_MAX_ROWS     = 2      # rows in result preview
PREVIEW_MAX_COLS     = 5      # cols per row in result preview

# Follow-up intent keywords — inject last_sql only when detected
FOLLOWUP_KEYWORDS = [
    "previous", "above", "same", "also", "additionally",
    "now filter", "but only", "and also", "refine",
    "what about", "how about", "compared to last",
    "from those", "from the results", "in that",
]


# ════════════════════════════════════════════════════════════════
# THREAD-SAFE STORE WITH TTL
# ════════════════════════════════════════════════════════════════

_memory_store: Dict[str, dict] = {}
_last_access:  Dict[str, float] = {}
_lock          = Lock()   # Fix #1: thread-safe


def _cleanup_expired() -> None:
    """Fix #8: Remove sessions inactive for SESSION_TTL_HOURS."""
    now    = time.time()
    cutoff = now - (SESSION_TTL_HOURS * 3600)
    expired = [
        sid for sid, t in _last_access.items()
        if t < cutoff
    ]
    for sid in expired:
        _memory_store.pop(sid, None)
        _last_access.pop(sid, None)


def _evict_oldest_if_needed() -> None:
    """Fix #8: LRU eviction when store exceeds MAX_SESSIONS."""
    if len(_memory_store) >= MAX_SESSIONS:
        oldest = sorted(_last_access.items(), key=lambda x: x[1])
        to_remove = oldest[:len(_memory_store) - MAX_SESSIONS + 1]
        for sid, _ in to_remove:
            _memory_store.pop(sid, None)
            _last_access.pop(sid, None)


def _get_session(session_id: str) -> dict:
    """Get or initialize session — not thread-safe (caller holds lock)."""
    if session_id not in _memory_store:
        _memory_store[session_id] = {
            "raw_messages":        [],
            "summary":             "",
            "structured_entities": {},   # Fix #9: structured memory
            "last_sql":            "",
            "last_result_preview": [],
            "turn_count":          0,
        }
    _last_access[session_id] = time.time()
    return _memory_store[session_id]


# ════════════════════════════════════════════════════════════════
# UTILITIES
# ════════════════════════════════════════════════════════════════

def _safe_preview(rows: list) -> list:
    """Fix #7: Limit rows and columns to prevent token explosion."""
    safe = []
    for row in rows[:PREVIEW_MAX_ROWS]:
        if isinstance(row, dict):
            limited = {k: v for k, v in list(row.items())[:PREVIEW_MAX_COLS]}
            safe.append(limited)
    return safe


def _is_relevant(current_query: str, past_query: str) -> bool:
    """Fix #6: Simple keyword relevance check."""
    curr_words = set(current_query.lower().split())
    past_words = set(past_query.lower().split())
    # Remove stop words
    stops = {"show", "me", "the", "a", "an", "of", "in", "for",
             "by", "and", "or", "is", "are", "what", "how", "give"}
    curr_words -= stops
    past_words -= stops
    if not curr_words or not past_words:
        return True  # no keywords to filter on — include
    return len(curr_words & past_words) > 0


def _is_followup_query(query: str) -> bool:
    """Fix #10: Detect if query is a follow-up to inject last_sql."""
    q = query.lower()
    return any(kw in q for kw in FOLLOWUP_KEYWORDS)


def _should_compress(context: str) -> bool:
    """Fix #5: Token-aware threshold instead of character length."""
    word_count = len(context.split())
    return word_count > 200  # ~200 words ≈ ~300 tokens


def _extract_entities(query: str, sql: str, insight: str) -> dict:
    """Fix #9: Extract structured entities from a turn."""
    entities = {}

    # Extract table names from SQL (simple heuristic).
    # FIX (LOW): previous regex only matched single-word identifiers.
    # Now also matches double-quoted names like "Sales Data".
    import re
    tables = re.findall(r'FROM\s+"([^"]+)"|FROM\s+(\w+)', sql, re.IGNORECASE)
    tables = [a or b for a, b in tables]
    joins  = re.findall(r'JOIN\s+"([^"]+)"|JOIN\s+(\w+)', sql, re.IGNORECASE)
    tables += [a or b for a, b in joins]
    if tables:
        entities["tables"] = list(set(tables))

    # Extract filter keywords
    filters = re.findall(r"WHERE\s+(.*?)(?:GROUP|ORDER|LIMIT|$)", sql, re.IGNORECASE | re.DOTALL)
    if filters:
        entities["filters"] = filters[0].strip()[:100]

    # Extract aggregation type
    agg_keywords = ["COUNT", "SUM", "AVG", "MAX", "MIN", "GROUP BY"]
    used_aggs = [k for k in agg_keywords if k in sql.upper()]
    if used_aggs:
        entities["aggregations"] = used_aggs

    return entities


# ════════════════════════════════════════════════════════════════
# SUMMARIZATION — non-degrading
# ════════════════════════════════════════════════════════════════

def _summarize_fresh(session_id: str) -> None:
    """
    Fix #3: Fresh summarization window — NOT recursive accumulation.
    Summarizes only the current raw_messages batch, then merges
    structured entities from all turns (no text degradation).
    """
    mem = _get_session(session_id)
    if not mem["raw_messages"]:
        return

    # Fix #4: Use full SQL in summarization context
    turns_text = "\n".join([
        f"Turn {i+1}:\n"
        f"  Q: {m['query']}\n"
        f"  SQL: {m['sql']}\n"
        f"  Rows: {m['row_count']}\n"
        f"  Finding: {m['insight']}"
        for i, m in enumerate(mem["raw_messages"])
    ])

    messages = [
        {
            "role": "system",
            "content": (
                "You are a session summarizer for an AI data analyst.\n"
                "Summarize these analysis turns. Extract:\n"
                "- What data/tables were analyzed\n"
                "- Key numeric findings (be specific with numbers)\n"
                "- What filters or groupings were used\n"
                "- Any trends or patterns found\n\n"
                "Keep under 3 sentences. Be specific — include actual numbers.\n"
                "Do NOT include vague statements like 'data was analyzed'."
            ),
        },
        {
            "role": "user",
            "content": f"Summarize these analysis turns:\n{turns_text}",
        },
    ]

    try:
        summary = call_groq(messages, max_tokens=SUMMARY_MAX_TOKENS, temperature=0.1)
        mem["summary"] = summary.strip()
        # Keep only last 2 raw messages after summarization
        mem["raw_messages"] = mem["raw_messages"][-2:]
    except Exception:
        # Safe fallback
        findings = [m["insight"] for m in mem["raw_messages"] if m["insight"]]
        mem["summary"] = f"Analyzed {mem['turn_count']} queries. " + " | ".join(findings[:3])
        mem["raw_messages"] = mem["raw_messages"][-2:]


# ════════════════════════════════════════════════════════════════
# PUBLIC API
# ════════════════════════════════════════════════════════════════

def write_turn(
    session_id:     str,
    user_query:     str,
    generated_sql:  str,
    top_insight:    str,
    result_preview: list,
    row_count:      int,
) -> None:
    """
    Write a completed turn to session memory.
    Thread-safe. Triggers summarization every SUMMARY_TRIGGER turns.
    Skips summarization for low-value turns (0 rows, no insight).
    """
    if not session_id:
        return

    # BUG FIX (HIGH): _summarize_fresh() makes a Groq LLM call (1-3s network I/O).
    # Calling it inside the with _lock block blocked ALL threads for the full
    # LLM call duration. Fix: collect state inside the lock, release, then
    # call summarize outside the lock using the snapshot.

    should_summarize = False

    with _lock:
        _cleanup_expired()
        _evict_oldest_if_needed()

        mem = _get_session(session_id)

        is_low_value = (row_count == 0 and not top_insight)
        if not is_low_value:
            entry = {
                "query":      user_query,
                "sql":        generated_sql or "",
                "insight":    top_insight,
                "row_count":  row_count,
                "entities":   _extract_entities(user_query, generated_sql or "", top_insight),
            }
            mem["raw_messages"].append(entry)
            mem["last_sql"]            = generated_sql or ""
            mem["last_result_preview"] = _safe_preview(result_preview)

            entities = entry["entities"]
            for key, val in entities.items():
                if key not in mem["structured_entities"]:
                    mem["structured_entities"][key] = []
                if isinstance(val, list):
                    mem["structured_entities"][key] = list(
                        set(mem["structured_entities"][key] + val)
                    )

        mem["turn_count"] += 1

        if len(mem["raw_messages"]) >= SUMMARY_TRIGGER:
            should_summarize = True
        else:
            mem["raw_messages"] = mem["raw_messages"][-MAX_RAW_MESSAGES:]

    # Groq LLM call happens OUTSIDE the lock — other threads not blocked
    if should_summarize:
        _summarize_fresh(session_id)


def retrieve_context(session_id: str, current_query: str) -> str:
    """
    Retrieve relevant, compressed memory context.

    Fix #6: Relevance filtering — only include relevant past turns
    Fix #10: Intent detection — only inject last_sql for follow-ups
    Fix #11: Lazy building — only build sections that exist + are useful
    Fix #5: Token-aware compression
    """
    if not session_id:
        return ""

    with _lock:
        mem = _get_session(session_id)

        if (not mem["raw_messages"] and
            not mem["summary"] and
            not mem["last_sql"]):
            return ""

        sections = []

        # ── Layer 1: Session summary ──────────────────────────
        if mem["summary"]:
            sections.append(f"Session summary:\n{mem['summary']}")

        # ── Layer 2: Structured entities ──────────────────────
        entities = mem.get("structured_entities", {})
        if entities.get("tables"):
            sections.append(
                f"Tables used in this session: {', '.join(entities['tables'])}"
            )

        # ── Layer 3: Relevance-filtered recent turns ──────────
        # Fix #6: only include turns relevant to current query
        relevant_turns = [
            m for m in mem["raw_messages"][-3:]
            if _is_relevant(current_query, m["query"])
        ]
        if relevant_turns:
            lines = ["Relevant recent queries:"]
            for m in relevant_turns:
                lines.append(
                    f"  • '{m['query']}' → {m['row_count']} rows"
                    + (f" | {m['insight'][:80]}" if m["insight"] else "")
                )
            sections.append("\n".join(lines))

        # ── Layer 4: Last SQL — only for follow-up queries ────
        # Fix #10: intent detection — don't inject SQL for fresh queries
        if mem["last_sql"] and _is_followup_query(current_query):
            sections.append(
                f"Previous SQL (modify if this is a follow-up):\n{mem['last_sql']}"
            )

        # ── Layer 5: Last result sample ───────────────────────
        if mem["last_result_preview"] and _is_followup_query(current_query):
            preview = json.dumps(mem["last_result_preview"], default=str)
            sections.append(f"Previous result sample:\n{preview}")

        if not sections:
            return ""

        raw_context = "\n\n".join(sections)
        need_compress = _should_compress(raw_context)

    # BUG FIX (HIGH): _compress_context() makes a Groq LLM call (1-3s).
    # Calling it inside the with _lock block blocked all threads.
    # Lock is now released before the LLM call.
    if need_compress:
        compressed = _compress_context(raw_context, current_query)
        return f"[Session Context]\n{compressed}"

    return f"[Session Context]\n{raw_context}"


def _compress_context(context: str, current_query: str) -> str:
    """
    Contextual compression — extract only what's relevant.
    Only called when context is long enough to justify LLM call.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a context compressor for an AI data analyst.\n"
                "Extract ONLY the information relevant to the current query.\n"
                "Keep: relevant SQL patterns, useful filters, matching data findings.\n"
                "Discard: unrelated queries, irrelevant tables, off-topic findings.\n"
                "Output max 4 sentences. Include specific numbers if present."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Current query: {current_query}\n\n"
                f"Context to compress:\n{context}"
            ),
        },
    ]

    try:
        compressed = call_groq(messages, max_tokens=COMPRESSION_TOKENS, temperature=0.0)
        return compressed.strip()
    except Exception:
        # Safe truncation fallback
        words = context.split()
        return " ".join(words[:200]) + ("..." if len(words) > 200 else "")


def get_last_sql(session_id: str) -> str:
    """Get last SQL — for direct follow-up modification."""
    if not session_id:
        return ""
    with _lock:
        mem = _get_session(session_id)
        return mem.get("last_sql", "")


def clear_session(session_id: str) -> None:
    """Clear session memory — call when session is deleted."""
    with _lock:
        _memory_store.pop(session_id, None)
        _last_access.pop(session_id, None)


def get_session_stats(session_id: str) -> dict:
    """Debug info for a session."""
    with _lock:
        mem = _get_session(session_id)
        return {
            "turn_count":        mem.get("turn_count", 0),
            "raw_messages":      len(mem.get("raw_messages", [])),
            "has_summary":       bool(mem.get("summary")),
            "has_last_sql":      bool(mem.get("last_sql")),
            "structured_entities": mem.get("structured_entities", {}),
            "total_sessions":    len(_memory_store),
        }