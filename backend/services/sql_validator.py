"""
services/sql_validator.py — AST-based SQL validation using sqlglot

Replaces string-based is_safe_sql() with proper AST parsing.
Catches edge cases like:
  WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x;
"""

import re
from typing import Tuple

try:
    import sqlglot
    import sqlglot.expressions as exp

    # Build forbidden types dynamically — handles version differences
    _FORBIDDEN = []
    for name in ["Insert", "Update", "Delete", "Drop", "Create",
                 "Alter", "AlterTable", "Command", "Grant", "Revoke",
                 "Truncate", "TruncateTable", "Use", "Set"]:
        node = getattr(exp, name, None)
        if node is not None:
            _FORBIDDEN.append(node)

    FORBIDDEN_NODE_TYPES = tuple(_FORBIDDEN)
    SQLGLOT_AVAILABLE    = True

except ImportError:
    SQLGLOT_AVAILABLE    = False
    FORBIDDEN_NODE_TYPES = ()


def validate_sql_ast(sql: str) -> Tuple[bool, str]:
    """
    Validate SQL using AST parsing.
    Falls back to string-based check if sqlglot not installed.
    Returns (is_valid, reason).
    """
    if not SQLGLOT_AVAILABLE:
        return _string_fallback(sql)

    sql = sql.strip()
    if not sql:
        return False, "Empty SQL"

    try:
        # BUG FIX (MEDIUM): sqlglot.parse() defaults to generic SQL dialect.
        # DuckDB-specific functions like TRY_CAST, regexp_extract, LIST_AGG,
        # and EXCLUDE were being rejected as parse errors, making valid DuckDB
        # SQL fail validation. Specifying dialect="duckdb" fixes this.
        statements = sqlglot.parse(sql, dialect="duckdb")
    except Exception as e:
        return False, f"SQL parse error: {str(e)}"

    if not statements:
        return False, "No valid SQL found"

    for stmt in statements:
        if stmt is None:
            continue

        # Top-level must be SELECT or With (CTE)
        if not isinstance(stmt, (exp.Select, exp.With)):
            stmt_type = type(stmt).__name__
            return False, f"Only SELECT queries allowed. Got: {stmt_type}"

        # Walk ALL nodes — including inside CTEs
        if FORBIDDEN_NODE_TYPES:
            for node in stmt.walk():
                if isinstance(node, FORBIDDEN_NODE_TYPES):
                    node_type = type(node).__name__
                    return False, f"Forbidden operation detected: {node_type}"

    return True, "OK"


def _string_fallback(sql: str) -> Tuple[bool, str]:
    """String-based fallback when sqlglot is unavailable."""
    q = re.sub(r"--[^\n]*", "", sql)
    q = re.sub(r"/\*.*?\*/", "", q, flags=re.DOTALL)
    q = q.lower().strip()

    if not (q.startswith("select") or q.startswith("with")):
        return False, "SQL must start with SELECT or WITH"

    forbidden = [
        "insert ", "update ", "delete ", "drop ",
        "alter ", "truncate ", "create ", "grant ",
        "revoke ", "replace ", "merge ", "exec ",
        "execute ", "call ", "pragma ",
    ]
    for word in forbidden:
        if word in q:
            return False, f"Forbidden keyword: {word.strip()}"

    return True, "OK"


def estimate_query_complexity(sql: str, dataset_row_count: int) -> Tuple[bool, str]:
    """
    Estimate query complexity. Returns (is_acceptable, reason).
    Rejects joins > 3 tables or missing WHERE on large datasets.
    """
    if not SQLGLOT_AVAILABLE:
        return True, "OK"

    try:
        statements = sqlglot.parse(sql, dialect="duckdb")
        if not statements or statements[0] is None:
            return True, "OK"

        stmt = statements[0]

        # Count JOINs
        joins = list(stmt.find_all(exp.Join))
        if len(joins) > 3:
            return False, f"Query has {len(joins)} JOINs — max 3 allowed"

        # Require WHERE on large datasets
        if dataset_row_count > 100_000:
            wheres = list(stmt.find_all(exp.Where))
            if not wheres:
                return False, (
                    f"Dataset has {dataset_row_count:,} rows. "
                    "Please add a WHERE clause to limit results."
                )

        return True, "OK"

    except Exception:
        return True, "OK"