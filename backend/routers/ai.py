import os
import re
import uuid
import json
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import duckdb
import pandas as pd
from groq import Groq
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from services.sql_validator import validate_sql_ast, estimate_query_complexity
from services.cache import get_cached_sql, cache_sql, get_cached_insights, cache_insights
from services.logger import log_query

# BUG FIX: run_agent was called in agent_analyze without being imported.
# Every call to POST /ai/agent crashed with NameError: name 'run_agent' is not defined.
from services.agent import run_agent

from database import get_db
from models import (
    User, Dataset, DatasetTable, ChatSession,
    AIQuery, QueryResult, Visualization, Insight, Recommendation,
)
from routers.auth import get_current_user
from schemas.ai import (
    AnalyzeRequest,
    AnalyzeResponse,
    GenerateSQLRequest,
    GenerateSQLResponse,
    InsightResponse,
    RecommendationResponse,
    VisualizationResponse,
    QueryResultResponse,
    AgentRequest,
    AgentResponse,
)

load_dotenv()

router = APIRouter()

# ── Groq config ───────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

MAX_PREVIEW_ROWS = 100

from services.utils import (
    call_groq,
    is_safe_sql,
    extract_sql_from_response,
    execute_sql_duckdb,
    build_schema_text,
    get_groq_client,
)


# ════════════════════════════════════════════════════════════════
# UTILITIES
# ════════════════════════════════════════════════════════════════

def validate_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label} format",
        )


def get_dataset_or_403(
    db: Session,
    dataset_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if ds.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return ds


def get_query_or_403(
    db: Session,
    query_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AIQuery:
    q = db.query(AIQuery).filter(AIQuery.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    if q.session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return q


# ════════════════════════════════════════════════════════════════
# SQL GENERATION
# ════════════════════════════════════════════════════════════════

def generate_sql_from_groq(schema_text: str, user_query: str) -> tuple[str, str]:
    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert SQL analyst. Generate accurate SQL SELECT queries "
                "based on the user's question and the provided schema.\n\n"
                "STRICT RULES:\n"
                "- ONLY generate SELECT queries. Never INSERT, UPDATE, DELETE, DROP, or ALTER.\n"
                "- Use EXACT table and column names from the schema.\n"
                "- Always wrap your SQL in a ```sql code block.\n"
                "- After the SQL, write a brief explanation of what the query does.\n"
                "- If the question cannot be answered with SQL, say so clearly.\n\n"
                f"Schema:\n{schema_text}"
            ),
        },
        {
            "role": "user",
            "content": f"Generate a SQL query to answer: {user_query}",
        },
    ]

    cached = get_cached_sql(user_query, schema_text)
    if cached:
        return cached, "SQL retrieved from cache."

    response_text = call_groq(messages, max_tokens=512, temperature=0.1)
    sql         = extract_sql_from_response(response_text)
    explanation = re.sub(r"```.*?```", "", response_text, flags=re.DOTALL).strip()
    if not explanation:
        explanation = "SQL query generated successfully."

    if sql:
        cache_sql(user_query, schema_text, sql)

    return sql or "", explanation


# ════════════════════════════════════════════════════════════════
# INSIGHT GENERATION
# ════════════════════════════════════════════════════════════════

def generate_insights(
    user_query: str,
    sql: str,
    results_preview: list[dict],
    row_count: int,
) -> List[dict]:
    if not results_preview:
        return []

    results_sample = json.dumps(
        [x for i, x in enumerate(results_preview) if i < 20], default=str
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a business intelligence analyst. "
                "Analyze the query results and provide exactly 3 key business insights.\n\n"
                "IMPORTANT RULES:\n"
                "- Be specific — use the actual numbers from the results.\n"
                "- Do NOT confuse total row count with filtered results.\n\n"
                "Format your response as a JSON array ONLY:\n"
                '[{"insight": "...", "importance": 0.9}, ...]'
            ),
        },
        {
            "role": "user",
            "content": (
                f"User question: {user_query}\n"
                f"SQL executed:\n{sql}\n\n"
                f"Number of result rows: {row_count}\n"
                f"Actual query results:\n{results_sample}"
            ),
        },
    ]

    response_text = call_groq(messages, max_tokens=512, temperature=0.2)

    try:
        clean      = re.sub(r"```.*?```", "", response_text, flags=re.DOTALL).strip()
        json_match = re.search(r"\[.*\]", clean, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            return [
                {"text": item.get("insight", ""), "score": float(item.get("importance", 0.5))}
                for item in data if item.get("insight")
            ]
    except (json.JSONDecodeError, ValueError):
        pass

    if response_text:
        return [{"text": response_text, "score": 0.5}]
    return []


# ════════════════════════════════════════════════════════════════
# RECOMMENDATION GENERATION
# ════════════════════════════════════════════════════════════════

def generate_recommendations(
    user_query: str,
    insights: list[dict],
    row_count: int,
) -> list[dict]:
    if not insights:
        return []

    insights_text = "\n".join(f"- {i['text']}" for i in insights)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a strategic business consultant. "
                "Based on the data insights provided, give exactly 3 actionable recommendations.\n\n"
                "Format your response as a JSON array ONLY:\n"
                '[{"recommendation": "...", "confidence": 0.9}, ...]'
            ),
        },
        {
            "role": "user",
            "content": (
                f"User question: {user_query}\n"
                f"Key insights from the data:\n{insights_text}\n"
                f"Total data points analyzed: {row_count}"
            ),
        },
    ]

    response_text = call_groq(messages, max_tokens=512, temperature=0.3)

    try:
        clean      = re.sub(r"```.*?```", "", response_text, flags=re.DOTALL).strip()
        json_match = re.search(r"\[.*\]", clean, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            return [
                {"text": item.get("recommendation", ""), "score": float(item.get("confidence", 0.5))}
                for item in data if item.get("recommendation")
            ]
    except (json.JSONDecodeError, ValueError):
        pass

    if response_text:
        return [{"text": response_text, "score": 0.5}]
    return []


# ════════════════════════════════════════════════════════════════
# VISUALIZATION CONFIG GENERATION
# ════════════════════════════════════════════════════════════════

def generate_chart_config(df: pd.DataFrame, user_query: str) -> Optional[dict]:
    if df.empty or len(df.columns) < 2:
        return None

    num_cols  = df.select_dtypes(include=["number"]).columns.tolist()
    str_cols  = df.select_dtypes(include=["object", "string", "category"]).columns.tolist()
    row_count = len(df)

    if not num_cols:
        return None

    if str_cols and num_cols:
        x_col      = str_cols[0]
        y_col      = num_cols[0]
        unique_vals = df[x_col].nunique()

        labels = df[x_col].astype(str).tolist()
        values = df[y_col].tolist()

        if 2 <= unique_vals <= 6:
            return {
                "type": "pie",
                "data": {
                    "labels": labels,
                    "datasets": [{
                        "data":            values,
                        "backgroundColor": [
                            "#6366f1", "#8b5cf6", "#ec4899",
                            "#f59e0b", "#10b981", "#3b82f6",
                        ],
                    }],
                },
                "options": {"responsive": True},
            }

        return {
            "type": "bar",
            "data": {
                "labels": labels,
                "datasets": [{
                    "label":           y_col,
                    "data":            values,
                    "backgroundColor": "#6366f1",
                    "borderRadius":    4,
                }],
            },
            "options": {
                "responsive": True,
                "plugins":    {"legend": {"display": False}},
                "scales":     {"y": {"beginAtZero": True}},
            },
        }

    if len(num_cols) >= 2:
        chart_type = "line" if row_count <= 50 else "scatter"
        return {
            "type": chart_type,
            "data": {
                "labels": list(range(len(df))),
                "datasets": [{
                    "label":       num_cols[1],
                    "data":        df[num_cols[1]].tolist(),
                    "borderColor": "#6366f1",
                    "fill":        False,
                    "tension":     0.4,
                }],
            },
            "options": {"responsive": True},
        }

    return None


# ════════════════════════════════════════════════════════════════
# POST /ai/analyze   (backwards-compat wrapper — calls run_agent)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Full AI analysis: generate SQL → execute → insights → recommendations",
)
def analyze(
    body:         AnalyzeRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    session_uid = validate_uuid(body.session_id, "session ID")
    dataset_uid = validate_uuid(body.dataset_id, "dataset ID")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uid,
        ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found or access denied")

    dataset     = get_dataset_or_403(db, dataset_uid, current_user.id)
    schema_text = build_schema_text(dataset)

    try:
        result = run_agent(
            user_query=body.user_query,
            schema_text=schema_text,
            dataset=dataset,
            session_id=str(session_uid),   # BUG FIX: pass real session UUID
        )
    except Exception as e:
        raise HTTPException(500, f"Agent failed: {str(e)}")

    log_query(
        user_query=body.user_query,
        generated_sql=result.get("generated_sql", ""),
        execution_time_ms=result.get("execution_time_ms", 0),
        row_count=result.get("row_count", 0),
        sql_attempts=result.get("sql_attempts", 1),
        error_msg=result.get("error", ""),
        session_id=str(session_uid),
        dataset_id=str(dataset_uid),
        route=result.get("route", "sql"),
    )

    from services.agent import sanitize_rows as _sanitize

    generated_sql = result.get("generated_sql", "")
    row_count     = result.get("row_count", 0)
    result_rows   = _sanitize(result.get("result_rows", []))

    ai_query     = None
    qr           = None
    insight_objs = []
    rec_objs     = []
    viz_objs     = []

    if generated_sql and result_rows:
        try:
            ai_query = AIQuery(
                session_id=session_uid,
                user_query=body.user_query,
                generated_sql=generated_sql,
                sql_valid=True,
                execution_time_ms=result.get("execution_time_ms", 0),
            )
            db.add(ai_query)
            db.flush()

            qr = QueryResult(
                query_id=ai_query.id,
                result_row_count=row_count,
                result_preview=result_rows,
            )
            db.add(qr)

            for ins in result.get("insights", []):
                obj = Insight(
                    query_id=ai_query.id,
                    insight_text=ins["text"],
                    importance_score=ins["score"],
                )
                db.add(obj)
                insight_objs.append(obj)

            for rec in result.get("recommendations", []):
                obj = Recommendation(
                    query_id=ai_query.id,
                    recommendation_text=rec["text"],
                    confidence_score=rec["score"],
                )
                db.add(obj)
                rec_objs.append(obj)

            if result.get("chart_config"):
                obj = Visualization(
                    query_id=ai_query.id,
                    chart_type=result["chart_config"].get("type", "bar"),
                    chart_config=result["chart_config"],
                )
                db.add(obj)
                viz_objs.append(obj)

            session.last_activity = datetime.utcnow()
            db.commit()
            if ai_query: db.refresh(ai_query)
            if qr:       db.refresh(qr)
        except Exception:
            db.rollback()

    now = datetime.utcnow()

    if insight_objs and all(hasattr(o, "id") and getattr(o, "id", None) for o in insight_objs):
        insights_out = insight_objs
    else:
        insights_out = [
            {"id": None, "insight_text": ins["text"],
             "importance_score": ins.get("score", 0.5), "created_at": now}
            for ins in result.get("insights", [])
        ]

    if rec_objs and all(hasattr(o, "id") and getattr(o, "id", None) for o in rec_objs):
        recs_out = rec_objs
    else:
        recs_out = [
            {"id": None, "recommendation_text": rec["text"],
             "confidence_score": rec.get("score", 0.5), "created_at": now}
            for rec in result.get("recommendations", [])
        ]

    viz_out = []
    if result.get("chart_config"):
        if viz_objs and all(hasattr(o, "id") and getattr(o, "id", None) for o in viz_objs):
            viz_out = viz_objs
        else:
            viz_out = [{
                "id": None,
                "chart_type":   result["chart_config"].get("type", "bar"),
                "chart_config": result["chart_config"],
                "created_at":   now,
            }]

    return {
        "query_id":          ai_query.id if (ai_query and ai_query.id) else None,
        "user_query":        body.user_query,
        "generated_sql":     generated_sql,
        "sql_valid":         bool(generated_sql and result.get("result_rows")),
        "execution_time_ms": result.get("execution_time_ms", 0),
        "result": {
            "id":               qr.id if (qr and qr.id) else None,
            "result_row_count": row_count,
            "result_preview":   result_rows,
            "created_at":       qr.created_at if (qr and qr.id) else now,
        } if (result_rows or qr) else None,
        "visualizations":      viz_out,
        "insights":            insights_out,
        "recommendations":     recs_out,
        # FIX: expose error and final_answer so clients know WHY a query failed
        # Previously these were silently dropped — users saw sql_valid:false with no reason
        "error":               result.get("error") or result.get("sql_error"),
        "final_answer":        result.get("final_answer"),
        "followup_questions":  result.get("followup_questions", []),
    }


# ════════════════════════════════════════════════════════════════
# POST /ai/generate-sql
# ════════════════════════════════════════════════════════════════

@router.post(
    "/generate-sql",
    response_model=GenerateSQLResponse,
    summary="Generate SQL only — without executing it",
)
def generate_sql_only(
    body:         GenerateSQLRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    dataset_uid = validate_uuid(body.dataset_id, "dataset ID")
    dataset     = get_dataset_or_403(db, dataset_uid, current_user.id)
    schema_text = build_schema_text(dataset)

    sql, explanation = generate_sql_from_groq(schema_text, body.user_query)

    if not sql:
        raise HTTPException(422, "Could not generate SQL. Try rephrasing your question.")

    return {"generated_sql": sql, "explanation": explanation}


# ════════════════════════════════════════════════════════════════
# GET /ai/results/{query_id}
# ════════════════════════════════════════════════════════════════

@router.get(
    "/results/{query_id}",
    response_model=QueryResultResponse,
    summary="Get stored query results",
)
def get_results(
    query_id:     str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    quid  = validate_uuid(query_id, "query ID")
    query = get_query_or_403(db, quid, current_user.id)
    if not query.result:
        raise HTTPException(404, "No results found for this query")
    return query.result


# ════════════════════════════════════════════════════════════════
# GET /ai/insights/{query_id}
# ════════════════════════════════════════════════════════════════

@router.get(
    "/insights/{query_id}",
    response_model=List[InsightResponse],
    summary="Get AI insights for a query",
)
def get_insights(
    query_id:     str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    quid  = validate_uuid(query_id, "query ID")
    query = get_query_or_403(db, quid, current_user.id)
    return sorted(query.insights, key=lambda i: i.importance_score or 0, reverse=True)


# ════════════════════════════════════════════════════════════════
# GET /ai/recommendations/{query_id}
# ════════════════════════════════════════════════════════════════

@router.get(
    "/recommendations/{query_id}",
    response_model=List[RecommendationResponse],
    summary="Get AI recommendations for a query",
)
def get_recommendations(
    query_id:     str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    quid  = validate_uuid(query_id, "query ID")
    query = get_query_or_403(db, quid, current_user.id)
    return sorted(query.recommendations, key=lambda r: r.confidence_score or 0, reverse=True)


# ════════════════════════════════════════════════════════════════
# GET /ai/visualizations/{query_id}
# ════════════════════════════════════════════════════════════════

@router.get(
    "/visualizations/{query_id}",
    response_model=List[VisualizationResponse],
    summary="Get chart configurations for a query",
)
def get_visualizations(
    query_id:     str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    quid  = validate_uuid(query_id, "query ID")
    query = get_query_or_403(db, quid, current_user.id)
    return query.visualizations


# ════════════════════════════════════════════════════════════════
# POST /ai/agent   — LangGraph agentic endpoint
# ════════════════════════════════════════════════════════════════

@router.post(
    "/agent",
    response_model=AgentResponse,
    summary="Agentic AI analyst — routes SQL vs explanation, auto-retries on failure",
)
def agent_analyze(
    body:         AgentRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    session_uid = validate_uuid(body.session_id, "session ID")
    dataset_uid = validate_uuid(body.dataset_id, "dataset ID")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uid,
        ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found or access denied")

    dataset     = get_dataset_or_403(db, dataset_uid, current_user.id)
    schema_text = build_schema_text(dataset)

    try:
        # BUG FIX 1: run_agent was never imported — crashed with NameError on every call.
        # BUG FIX 2: session_id was never passed — memory was keyed by dataset.id,
        #            causing cross-user memory contamination on shared datasets.
        result = run_agent(
            user_query=body.user_query,
            schema_text=schema_text,
            dataset=dataset,
            session_id=str(session_uid),
        )
    except Exception as e:
        raise HTTPException(500, f"Agent failed: {str(e)}")

    # Persist to DB if SQL succeeded
    if result.get("route") == "sql" and result.get("result_rows"):
        try:
            ai_query = AIQuery(
                session_id=session_uid,
                user_query=body.user_query,
                generated_sql=result.get("generated_sql"),
                sql_valid=True,
                execution_time_ms=result.get("execution_time_ms", 0),
            )
            db.add(ai_query)
            db.flush()

            db.add(QueryResult(
                query_id=ai_query.id,
                result_row_count=result.get("row_count", 0),
                result_preview=result.get("result_rows", []),
            ))

            for ins in result.get("insights", []):
                db.add(Insight(
                    query_id=ai_query.id,
                    insight_text=ins["text"],
                    importance_score=ins["score"],
                ))

            for rec in result.get("recommendations", []):
                db.add(Recommendation(
                    query_id=ai_query.id,
                    recommendation_text=rec["text"],
                    confidence_score=rec["score"],
                ))

            if result.get("chart_config"):
                db.add(Visualization(
                    query_id=ai_query.id,
                    chart_type=result["chart_config"].get("type", "bar"),
                    chart_config=result["chart_config"],
                ))

            session.last_activity = datetime.utcnow()
            db.commit()

        except Exception:
            db.rollback()
            # DB persistence failure never breaks the API response

    return {
        "route":               result.get("route", "sql"),
        "user_query":          body.user_query,
        "plan":                result.get("plan"),
        "selected_tables":     result.get("selected_tables", []),
        "generated_sql":       result.get("generated_sql"),
        "reviewed_sql":        result.get("reviewed_sql"),
        "sql_explanation":     result.get("sql_explanation"),
        "sql_valid":           result.get("sql_valid", False),
        "sql_attempts":        result.get("sql_attempts", 0),
        "error_type":          result.get("error_type"),
        "row_count":           result.get("row_count", 0),
        "result_preview":      result.get("result_rows", []),
        "result_stats":        result.get("result_stats"),
        "result_valid":        result.get("result_valid", False),
        "result_issue":        result.get("result_issue"),
        "insights":            result.get("insights", []),
        "recommendations":     result.get("recommendations", []),
        "chart_config":        result.get("chart_config"),
        "followup_questions":  result.get("followup_questions", []),
        "explanation":         result.get("explanation"),
        "final_answer":        result.get("final_answer"),
        "execution_time_ms":   result.get("execution_time_ms", 0),
        "error":               result.get("error"),
        "confidence_score":    result.get("confidence_score"),
        "generated_code":      result.get("generated_code"),
        "code_output":         result.get("code_output"),
    }


# ════════════════════════════════════════════════════════════════
# POST /ai/agent/stream   — SSE Stream endpoint
# ════════════════════════════════════════════════════════════════

@router.post(
    "/agent/stream",
    summary="SSE endpoint that streams agent progress and final results",
)
def agent_analyze_stream(
    body:         AgentRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Streams intermediate states of the LangGraph agent via Server-Sent Events.
    Events: 'progress' (SQL generated, querying, etc.) and 'complete' (final AgentResponse).
    """
    session_uid = validate_uuid(body.session_id, "session ID")
    dataset_uid = validate_uuid(body.dataset_id, "dataset ID")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uid,
        ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(404, "Session not found or access denied")

    dataset = get_dataset_or_403(db, dataset_uid, current_user.id)
    schema_text = build_schema_text(dataset)

    def event_generator():
        # Compile agent instance
        from services.agent import build_agent
        agent_graph = build_agent()
        
        initial_state = {
            "user_query":          body.user_query,
            "schema_text":         schema_text,
            "filtered_schema":     schema_text,
            "dataset":             dataset,
            "session_id":          str(session_uid),
            "session_memory":      "",
            "route":               "",
            "plan":                None,
            "selected_tables":     [],
            "generated_sql":       None,
            "reviewed_sql":        None,
            "sql_explanation":     None,
            "sql_valid":           False,
            "sql_attempts":        0,
            "sql_error":           None,
            "error_type":          None,
            "error_strategy":      None,
            "result_df":           None,
            "result_rows":         [],
            "row_count":           0,
            "result_stats":        {},
            "result_valid":        False,
            "result_issue":        None,
            "scraped_context":     None,
            "insights":            [],
            "recommendations":     [],
            "chart_config":        None,
            "explanation":         None,
            "followup_questions":  [],
            "last_sql":            None,
            "final_answer":        None,
            "error":               None,
            "execution_time_ms":   0,
        }
        
        # Stream intermediate graph states
        final_state: dict = initial_state.copy()
        for step in agent_graph.stream(initial_state):
            # step is a dict like {'node_name': {state_updates}}
            for node_name, state in step.items():
                final_state = state
                msg = "Processing..."
                if node_name == "router":
                    msg = "Routing query..."
                elif node_name == "schema_selector":
                    msg = "Selecting relevant tables..."
                elif node_name == "generate_sql":
                    msg = "Writing SQL query..."
                elif node_name == "execute_sql":
                    msg = "Executing query..."
                elif node_name == "generate_python":
                    msg = "Writing Python script..."
                elif node_name == "execute_python":
                    msg = "Executing Python sandbox..."
                elif node_name == "insights":
                    msg = "Formulating business insights..."
                elif node_name == "scrape_web":
                    msg = "Fetching latest industry news..."
                elif node_name == "recommendations":
                    msg = "Generating strategic recommendations..."
                elif node_name == "chart":
                    msg = "Designing visualizations..."
                
                # Send progress SSE event
                payload = json.dumps({"status": msg, "node": node_name})
                yield f"event: progress\ndata: {payload}\n\n"
        
        if final_state is None:
            final_state = initial_state
            
        # Compile the final result structure (matches regular /agent response)
        result = {
            "route":               final_state.get("route", "sql"),
            "user_query":          body.user_query,
            "plan":                final_state.get("plan"),
            "selected_tables":     final_state.get("selected_tables", []),
            "generated_sql":       final_state.get("generated_sql"),
            "reviewed_sql":        final_state.get("reviewed_sql"),
            "sql_explanation":     final_state.get("sql_explanation"),
            "sql_valid":           final_state.get("sql_valid", False),
            "sql_attempts":        final_state.get("sql_attempts", 0),
            "error_type":          final_state.get("error_type"),
            "row_count":           final_state.get("row_count", 0),
            "result_preview":      final_state.get("result_rows", []),
            "result_stats":        final_state.get("result_stats"),
            "result_valid":        final_state.get("result_valid", False),
            "result_issue":        final_state.get("result_issue"),
            "insights":            final_state.get("insights", []),
            "recommendations":     final_state.get("recommendations", []),
            "chart_config":        final_state.get("chart_config"),
            "followup_questions":  final_state.get("followup_questions", []),
            "explanation":         final_state.get("explanation"),
            "final_answer":        final_state.get("final_answer"),
            "execution_time_ms":   final_state.get("execution_time_ms", 0),
            "error":               final_state.get("error"),
            "confidence_score":    final_state.get("confidence_score"),
            "generated_code":      final_state.get("generated_code"),
            "code_output":         final_state.get("code_output"),
        }
        
        # Persist to DB if valid sql/python
        if (result.get("route") in ("sql", "refine", "python")) and result.get("result_rows"):
            try:
                # Local session to avoid thread safety issues in generator
                db_generator = next(get_db())
                from models import ChatSession, AIQuery, QueryResult, Insight, Recommendation, Visualization
                # Get the session using local db
                sess = db_generator.query(ChatSession).filter(ChatSession.id == session_uid).first()
                if sess:
                    ai_query = AIQuery(
                        session_id=session_uid,
                        user_query=body.user_query,
                        generated_sql=result.get("generated_sql"),
                        sql_valid=True,
                        execution_time_ms=result.get("execution_time_ms", 0),
                    )
                    db_generator.add(ai_query)
                    db_generator.flush()

                    db_generator.add(QueryResult(
                        query_id=ai_query.id,
                        result_row_count=result.get("row_count", 0),
                        result_preview=result.get("result_rows", []),
                    ))

                    insights = result.get("insights")
                    if isinstance(insights, list):
                        for ins in insights:
                            if isinstance(ins, dict):
                                db_generator.add(Insight(
                                    query_id=ai_query.id,
                                    insight_text=ins.get("text", ""),
                                    importance_score=ins.get("score", 0.5),
                                ))

                    recs = result.get("recommendations")
                    if isinstance(recs, list):
                        for rec in recs:
                            if isinstance(rec, dict):
                                db_generator.add(Recommendation(
                                    query_id=ai_query.id,
                                    recommendation_text=rec.get("text", ""),
                                    confidence_score=rec.get("score", 0.5),
                                ))

                    chart_config = result.get("chart_config")
                    if isinstance(chart_config, dict):
                        db_generator.add(Visualization(
                            query_id=ai_query.id,
                            chart_type=chart_config.get("type", "bar"),
                            chart_config=chart_config,
                        ))

                    sess.last_activity = datetime.utcnow()
                    db_generator.commit()
            except Exception:
                pass # Ignoring DB errors in stream

        # Send final completion event
        payload = json.dumps(result, default=str)
        yield f"event: complete\ndata: {payload}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")