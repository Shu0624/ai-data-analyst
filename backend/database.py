import os
from contextlib import asynccontextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in your .env file")

# Resilient connection establishment with self-healing offline SQLite fallback
try:
    if DATABASE_URL.startswith("sqlite"):
        engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
    else:
        engine = create_engine(
            DATABASE_URL,
            echo=False,
            pool_pre_ping=True,      # silently reconnect if DB restarts
            pool_size=10,            # max persistent connections
            max_overflow=20,         # extra connections under heavy load
        )
        # Test connection immediately
        with engine.connect() as conn:
            pass
except Exception as e:
    print(f"WARNING: DATABASE CONNECTION FAILED: {e}. Falling back to local SQLite: 'sqlite:///./local_test.db'")
    DATABASE_URL = "sqlite:///./local_test.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()