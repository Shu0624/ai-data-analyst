from pydantic import BaseModel, field_validator
from typing import Optional, List, Any
from uuid import UUID
from datetime import datetime


# ── Analyze Request ───────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    session_id:  str
    dataset_id:  str
    user_query:  str

    @field_validator("user_query")
    @classmethod
    def query_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Query cannot be empty")
        if len(v.strip()) > 2000:
            raise ValueError("Query too long (max 2000 characters)")
        return v.strip()


# ── SQL Generation Only ───────────────────────────────────────
class GenerateSQLRequest(BaseModel):
    dataset_id: str
    user_query: str

    @field_validator("user_query")
    @classmethod
    def query_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Query cannot be empty")
        return v.strip()


class GenerateSQLResponse(BaseModel):
    generated_sql: str
    explanation:   str


# ── Insight Response ──────────────────────────────────────────
class InsightResponse(BaseModel):
    id:               Optional[UUID]    = None
    insight_text:     str
    importance_score: Optional[float]   = None
    created_at:       Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Recommendation Response ───────────────────────────────────
class RecommendationResponse(BaseModel):
    id:                  Optional[UUID]    = None
    recommendation_text: str
    confidence_score:    Optional[float]   = None
    created_at:          Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Visualization Response ────────────────────────────────────
class VisualizationResponse(BaseModel):
    id:           Optional[UUID]     = None
    chart_type:   str
    chart_config: dict
    created_at:   Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Query Result Response ─────────────────────────────────────
class QueryResultResponse(BaseModel):
    id:               Optional[UUID]   = None
    result_row_count: Optional[int]    = None
    result_preview:   Optional[List[dict]] = None
    created_at:       Optional[datetime]   = None

    class Config:
        from_attributes = True


# ── Full Analyze Response ─────────────────────────────────────
class AnalyzeResponse(BaseModel):
    query_id:          Optional[UUID]   = None   # None when explain route or SQL fails
    user_query:        str
    generated_sql:     Optional[str]   = None
    sql_valid:         bool            = False
    execution_time_ms: Optional[int]   = None
    result:            Optional[QueryResultResponse] = None
    visualizations:    List[VisualizationResponse]   = []
    insights:          List[InsightResponse]          = []
    recommendations:   List[RecommendationResponse]  = []
    error:             Optional[str]   = None
    final_answer:      Optional[str]   = None
    followup_questions: List[str]      = []
    confidence_score:  Optional[float] = None


# ── Generic Message ───────────────────────────────────────────
class MessageResponse(BaseModel):
    message: str


# ── Agent Request ─────────────────────────────────────────────
class AgentRequest(BaseModel):
    session_id:  str
    dataset_id:  str
    user_query:  str

    @field_validator("user_query")
    @classmethod
    def query_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Query cannot be empty")
        if len(v.strip()) > 2000:
            raise ValueError("Query too long (max 2000 characters)")
        return v.strip()


# ── Agent Response ────────────────────────────────────────────
class AgentResponse(BaseModel):
    route:               str
    user_query:          str
    plan:                Optional[str]       = None
    selected_tables:     List[str]           = []
    generated_sql:       Optional[str]       = None
    reviewed_sql:        Optional[str]       = None
    sql_explanation:     Optional[str]       = None
    sql_valid:           bool                = False
    sql_attempts:        int                 = 0
    error_type:          Optional[str]       = None
    row_count:           int                 = 0
    result_preview:      Optional[List[dict]] = None
    result_stats:        Optional[dict]      = None
    result_valid:        bool                = False
    result_issue:        Optional[str]       = None
    insights:            List[dict]          = []
    recommendations:     List[dict]          = []
    chart_config:        Optional[dict]      = None
    followup_questions:  List[str]           = []
    explanation:         Optional[str]       = None
    final_answer:        Optional[str]       = None
    execution_time_ms:   int                 = 0
    error:               Optional[str]       = None
    confidence_score:    Optional[float]     = None
    generated_code:      Optional[str]       = None
    code_output:         Optional[str]       = None