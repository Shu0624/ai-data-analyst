import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("Adding suggested_questions column to datasets table...")
    try:
        conn.execute(text("ALTER TABLE datasets ADD COLUMN suggested_questions JSONB;"))
        conn.commit()
        print("Column added successfully.")
    except Exception as e:
        print(f"Error adding column (it might already exist): {e}")
