"""
services/profiler.py — Dataset profiling and query suggestion generation.

Generates statistical profiles from pandas DataFrames and uses Groq to
suggest starter questions for a newly uploaded dataset.

No new dependencies — uses only pandas, numpy (pandas dep), and existing
call_groq from utils.
"""

import json
import numpy as np
import pandas as pd
from typing import Optional

from services.utils import call_groq, build_schema_text


def generate_profile(dataframes: dict) -> dict:
    """
    Generate a statistical profile from uploaded DataFrames.
    Pure pandas/numpy — no LLM calls.

    Returns a dict with per-column stats + dataset-level summary.
    """
    profiles = {}

    for table_name, df in dataframes.items():
        if df.empty:
            profiles[table_name] = {"rows": 0, "columns": []}
            continue

        col_profiles = []
        num_cols = df.select_dtypes(include=["number"]).columns.tolist()
        txt_cols = df.select_dtypes(include=["object", "string", "category"]).columns.tolist()

        for col in df.columns:
            col_info = {
                "name":         str(col),
                "dtype":        str(df[col].dtype),
                "null_count":   int(df[col].isnull().sum()),
                "null_pct":     round(float(df[col].isnull().mean() * 100), 1),
                "unique_count": int(df[col].nunique()),
            }

            if col in num_cols:
                series = df[col].dropna()
                if len(series) > 0:
                    col_info["stats"] = {
                        "mean":   round(float(series.mean()), 2),
                        "median": round(float(series.median()), 2),
                        "min":    round(float(series.min()), 2),
                        "max":    round(float(series.max()), 2),
                        "std":    round(float(series.std()), 2),
                        "p25":    round(float(series.quantile(0.25)), 2),
                        "p75":    round(float(series.quantile(0.75)), 2),
                    }
                    # Detect skewness
                    try:
                        skew = float(series.skew())
                        if abs(skew) > 1:
                            col_info["stats"]["skewness"] = round(skew, 2)
                            col_info["stats"]["skew_direction"] = "right" if skew > 0 else "left"
                    except Exception:
                        pass

            elif col in txt_cols:
                # Top 5 most frequent values
                try:
                    top_vals = df[col].value_counts().head(5)
                    col_info["top_values"] = [
                        {"value": str(v), "count": int(c)}
                        for v, c in top_vals.items()
                    ]
                except Exception:
                    pass

            col_profiles.append(col_info)

        # Correlation matrix (numeric columns only, top correlations)
        correlations = []
        if len(num_cols) >= 2:
            try:
                corr_matrix = df[num_cols].corr()
                for i, c1 in enumerate(num_cols):
                    for c2 in num_cols[i + 1:]:
                        val = float(corr_matrix.loc[c1, c2])
                        if not np.isnan(val) and abs(val) > 0.3:
                            correlations.append({
                                "col1":        c1,
                                "col2":        c2,
                                "correlation": round(val, 3),
                                "strength":    "strong" if abs(val) > 0.7 else "moderate",
                            })
                correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)
                correlations = correlations[:10]  # Top 10 correlations
            except Exception:
                pass

        profiles[table_name] = {
            "rows":         len(df),
            "columns":      col_profiles,
            "correlations": correlations,
            "memory_mb":    round(df.memory_usage(deep=True).sum() / 1024 / 1024, 2),
        }

    return profiles


def generate_suggested_questions(dataset) -> list[str]:
    """
    Generate 5-8 interesting starter questions for a dataset.
    Single LLM call — uses schema text for context.
    Returns empty list on failure (never crashes the upload).
    """
    try:
        schema_text = build_schema_text(dataset)
    except Exception:
        return []

    messages = [
        {
            "role": "system",
            "content": (
                "You are a data analyst. Given a dataset schema, suggest exactly 6 "
                "interesting analysis questions a user could ask.\n\n"
                "Rules:\n"
                "- Questions should cover different analysis types: aggregation, "
                "ranking, comparison, trends, distribution.\n"
                "- Questions should be specific to the actual column names and data.\n"
                "- Questions should be natural language (not SQL).\n"
                "- Keep each question under 15 words.\n\n"
                "Respond ONLY with a JSON array of strings:\n"
                '["question 1", "question 2", ...]'
            ),
        },
        {
            "role": "user",
            "content": f"Dataset schema:\n{schema_text}",
        },
    ]

    try:
        import re
        response = call_groq(messages, max_tokens=300, temperature=0.4)
        clean = re.sub(r"```.*?```", "", response, flags=re.DOTALL).strip()
        # Try direct parse
        try:
            result = json.loads(clean)
            if isinstance(result, list):
                return [str(q) for q in result[:8] if q]
        except Exception:
            pass
        # Regex fallback
        match = re.search(r"\[.*\]", clean, re.DOTALL)
        if match:
            result = json.loads(match.group())
            if isinstance(result, list):
                return [str(q) for q in result[:8] if q]
    except Exception:
        pass

    return []
