
---

📄 README.md

# 🚀 AI Data Analyst Backend

A production-ready FastAPI backend that transforms natural language queries into SQL, executes them on structured datasets (CSV/Excel), and returns insights, visualizations, and recommendations — powered by an agentic AI pipeline.

---

## 🧠 Overview

This system allows users to:

- Ask questions in natural language
- Automatically generate SQL queries
- Execute queries on uploaded datasets
- Get:
  - 📊 Results
  - 📈 Visualizations
  - 💡 Insights
  - 🎯 Recommendations

All powered by a **LangGraph-based agentic pipeline** using Groq LLM.

---

## 🏗️ Architecture

Client → FastAPI → Auth → AI Router → LangGraph Agent → DuckDB → Response

### Core Flow

1. User sends query → `/ai/analyze` or `/ai/agent`
2. Request authenticated via JWT
3. Schema extracted from dataset
4. LangGraph Agent decides:
   - SQL route → generate + execute
   - Explain route → direct answer
5. Results processed:
   - Insights
   - Recommendations
   - Charts
6. Stored in PostgreSQL
7. Response returned

---

## ⚙️ Tech Stack

| Layer        | Technology |
|-------------|------------|
| Backend     | FastAPI |
| AI Engine   | Groq (LLaMA 3.1) |
| Agent Flow  | LangGraph |
| DB (App)    | PostgreSQL |
| Query Engine| DuckDB |
| ORM         | SQLAlchemy |
| Data        | Pandas |
| Validation  | sqlglot |

---

## 📂 Project Structure

. ├── main.py ├── database.py ├── models.py ├── schemas/ │   └── ai.py ├── routers/ │   ├── ai.py │   └── auth.py ├── services/ │   ├── agent.py │   ├── utils.py │   ├── memory.py │   ├── cache.py │   ├── sql_validator.py │   └── logger.py ├── uploads/ └── .env

---

## 🔑 Features

### 🤖 AI Capabilities
- Natural language → SQL generation
- Self-correcting SQL retries (up to 3 attempts)
- Schema-aware reasoning
- Business insights generation
- Actionable recommendations
- Automatic chart generation

### 🧩 Agent Features
- Multi-step LangGraph pipeline (~20 nodes)
- Dynamic routing (SQL vs Explanation)
- Error classification + recovery
- Session-based memory (fixed)
- Fallback SQL handling

### 📊 Data Support
- CSV files
- Excel files (multi-sheet)
- Large datasets (optimized via DuckDB)

---

## 🔐 Authentication

Uses JWT-based authentication.

All endpoints require:

Authorization: Bearer <token>

---

## 📡 API Endpoints

### 🔹 Analyze (Full Pipeline)

POST /ai/analyze

Runs full pipeline:
- SQL generation
- Execution
- Insights
- Recommendations
- Visualization

#### Request
```json
{
  "session_id": "uuid",
  "dataset_id": "uuid",
  "user_query": "top 3 expensive cars"
}


---

🔹 Agent (Smart Routing)

POST /ai/agent

Agent decides:

SQL execution OR

Direct explanation



---

🔹 Generate SQL

POST /ai/generate-sql

Returns SQL without execution.


---

🔹 Get Results

GET /ai/results/{query_id}


---

🔹 Insights

GET /ai/insights/{query_id}


---

🔹 Recommendations

GET /ai/recommendations/{query_id}


---

🔹 Visualizations

GET /ai/visualizations/{query_id}


---

🗄️ Database Design

Main entities:

User

Dataset

DatasetTable

ChatSession

AIQuery

QueryResult

Insight

Recommendation

Visualization



---

🧠 Agent Pipeline (Simplified)

Router
  ↓
Memory Retriever
  ↓
Schema Selector
  ↓
Planner
  ↓
SQL Generator
  ↓
SQL Validator
  ↓
Execution
  ↓
Result Validator
  ↓
Insights → Recommendations → Charts
  ↓
Final Response


---

⚠️ Important Fixes Applied

✅ Session-based memory (no cross-user leakage)

✅ Fixed JSON parsing for nested arrays

✅ SQL fallback uses actual dataset table

✅ Router misclassification reduced

✅ 0-row queries handled correctly

✅ Groq errors properly surfaced

✅ Table/column quoting fixed



---

🧪 Running Locally

1. Clone Repo

git clone <repo-url>
cd project


---

2. Create Virtual Environment

python -m venv venv
venv\Scripts\activate   # Windows


---

3. Install Dependencies

pip install -r requirements.txt


---

4. Setup .env

GROQ_API_KEY=your_key
GROQ_MODEL=llama-3.1-8b-instant
DATABASE_URL=postgresql://user:pass@localhost/db


---

5. Run Server

uvicorn main:app --reload

cd "E:\F\Ai data analyst\backend"
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000 --host 127.0.0.1


---

🐘 PostgreSQL Setup (Windows)

pg_ctl -D "C:\Program Files\PostgreSQL\15\data" start


---

📊 Example Query

"top 3 expensive cars"

Generated SQL:

SELECT Model, AVG(Avg_Price_EUR) AS Avg_Price
FROM BMW_Sales
GROUP BY Model
ORDER BY Avg_Price DESC
LIMIT 3;


---

⚡ Performance Notes

DuckDB runs in-memory → fast analytics

Groq API optimized for low latency

Max SQL retries: 3

Result preview capped at 100 rows



---

⚠️ Limitations

No persistent memory (in-memory only)

No async execution (blocking)

External DB execution not implemented yet

Depends on LLM accuracy



---

🎯 Design Principles

Keep it simple (no overengineering)

Fail gracefully inside agent

Fail loudly at API level

Minimal LLM calls (cost + latency control)

Schema-first reasoning



---

🚀 Future Improvements

Persistent memory (Redis)

Streaming responses

Async execution

Better routing classifier

Multi-dataset joins

Dashboard UI



---

👨‍💻 Author

Built for production-level AI data analysis use cases.


---

📜 License

MIT License

---

## 🧠 Final Note

This README is:
- Clean ✅  
- Recruiter/startup ready ✅  
- Not overengineered ✅  
- Matches your architecture exactly ✅  

---

If you want next level (this is where things get serious), I can help you add:

- 🔥 Architecture diagram (visual)
- 🔥 API Swagger customization
- 🔥 Production deployment guide (Docker + Nginx)
- 🔥 System design doc (for interviews)

Just say:
> "make it production deployment ready"

and we’ll push this to **real startup grade** 🚀