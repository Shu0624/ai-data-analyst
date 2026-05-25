"""
Run this file directly on your server:
    python diagnose.py

It checks 4 things:
1. Where uvicorn is running from
2. Whether the uploaded CSV file exists on disk  
3. What path is stored in PostgreSQL
4. Which version of utils.py is actually loaded by your server
"""

import os
import sys
from pathlib import Path

print("=" * 60)
print("DIAGNOSIS REPORT")
print("=" * 60)

# ── 1. Working directory ──────────────────────────────────────
cwd = os.getcwd()
print(f"\n1. SERVER WORKING DIRECTORY:\n   {cwd}")

# ── 2. uploads folder ─────────────────────────────────────────
uploads = Path(cwd) / "uploads"
print(f"\n2. UPLOADS FOLDER: {uploads}")
if uploads.exists():
    files = list(uploads.iterdir())
    if files:
        print(f"   Found {len(files)} file(s):")
        for f in sorted(files, key=lambda x: x.stat().st_mtime, reverse=True)[:5]:
            size = f.stat().st_size
            print(f"   ✅ {f.name}  ({size:,} bytes)")
    else:
        print("   ❌ EMPTY — no files here. This is why queries fail.")
else:
    print("   ❌ FOLDER DOES NOT EXIST")

# ── 3. Check PostgreSQL ───────────────────────────────────────
print("\n3. DATABASE FILE PATHS:")
try:
    from dotenv import load_dotenv
    load_dotenv()
    import sqlalchemy as sa
    
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        print("   ❌ DATABASE_URL not set in .env")
    else:
        engine = sa.create_engine(DATABASE_URL)
        with engine.connect() as conn:
            rows = conn.execute(sa.text(
                "SELECT id, dataset_name, file_path, created_at "
                "FROM datasets ORDER BY created_at DESC LIMIT 5"
            )).fetchall()
            for row in rows:
                fpath = row[2]
                exists = Path(fpath).exists() if fpath else False
                status = "✅ EXISTS" if exists else "❌ MISSING"
                print(f"\n   {status}")
                print(f"   id:         {row[0]}")
                print(f"   name:       {row[1]}")
                print(f"   file_path:  {fpath}")
                print(f"   created_at: {row[3]}")
except Exception as e:
    print(f"   ❌ DB check failed: {e}")

# ── 4. Which utils.py is loaded ───────────────────────────────
print("\n4. WHICH utils.py IS YOUR SERVER USING:")
try:
    import services.utils as u
    import inspect
    src = inspect.getsource(u.execute_sql_duckdb)
    if "re-upload your dataset" in src:
        print("   ✅ FIXED version loaded (has re-upload error message)")
    elif "read_csv_auto($1)" in src:
        print("   ✅ FIXED version loaded (has $1 param binding)")
    else:
        print("   ❌ OLD version loaded — fixed files not deployed")
    
    # Show file location
    print(f"   File: {inspect.getfile(u)}")
except Exception as e:
    print(f"   ❌ Could not import: {e}")

print("\n" + "=" * 60)
print("Copy and paste this entire output back to Claude.")
print("=" * 60)