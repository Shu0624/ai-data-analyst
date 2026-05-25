"""
services/cache.py — Simple in-memory caching layer

Caches:
- SQL per (query_hash + schema_hash) — avoids repeated LLM calls
- Insights per result_hash — avoids re-generating same insights

TTL: 1 hour
Max entries: 500 (LRU eviction)
"""

import hashlib
import time
from threading import RLock
from typing import Optional, Any
from collections import OrderedDict


class TTLCache:
    """
    Thread-safe LRU cache with TTL expiry.
    BUG FIX (MEDIUM): was using OrderedDict with no Lock. FastAPI runs in a
    thread pool — concurrent move_to_end / popitem calls on OrderedDict are
    not atomic and can corrupt state under load. Now uses threading.RLock
    (re-entrant so get() called from set() doesn't deadlock).
    """

    def __init__(self, max_size: int = 500, ttl_seconds: int = 3600):
        self.max_size   = max_size
        self.ttl        = ttl_seconds
        self._cache: OrderedDict = OrderedDict()
        self._lock      = RLock()

    def _make_key(self, *args) -> str:
        combined = "|".join(str(a) for a in args)
        return hashlib.md5(combined.encode()).hexdigest()

    def get(self, *key_parts) -> Optional[Any]:
        key = self._make_key(*key_parts)
        with self._lock:
            if key not in self._cache:
                return None
            value, expires_at = self._cache[key]
            if time.time() > expires_at:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return value

    def set(self, *key_parts_and_value) -> None:
        """Last argument is the value, rest are key parts."""
        *key_parts, value = key_parts_and_value
        key = self._make_key(*key_parts)
        with self._lock:
            while len(self._cache) >= self.max_size:
                self._cache.popitem(last=False)
            self._cache[key] = (value, time.time() + self.ttl)
            self._cache.move_to_end(key)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._cache)


# ── Module-level cache instances ──────────────────────────────
sql_cache     = TTLCache(max_size=500, ttl_seconds=3600)   # 1 hour
insight_cache = TTLCache(max_size=200, ttl_seconds=1800)   # 30 min


def get_cached_sql(user_query: str, schema_text: str) -> Optional[str]:
    """Get cached SQL for a query+schema combination."""
    return sql_cache.get(user_query.lower().strip(), schema_text)


def cache_sql(user_query: str, schema_text: str, sql: str) -> None:
    """Cache generated SQL."""
    sql_cache.set(user_query.lower().strip(), schema_text, sql)


def get_cached_insights(result_rows: list) -> Optional[list]:
    """Get cached insights for a result set."""
    result_hash = hashlib.md5(str(result_rows[:10]).encode()).hexdigest()
    return insight_cache.get(result_hash)


def cache_insights(result_rows: list, insights: list) -> None:
    """Cache generated insights."""
    result_hash = hashlib.md5(str(result_rows[:10]).encode()).hexdigest()
    insight_cache.set(result_hash, insights)