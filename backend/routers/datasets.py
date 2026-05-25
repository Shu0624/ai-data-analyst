import uuid
from pathlib import Path
from typing import List, Optional

import pandas as pd
import re
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status

from database import get_db
from models import User, Dataset, DatasetTable, DatasetColumn
from routers.auth import get_current_user
from services.profiler import generate_profile, generate_suggested_questions
from services.utils import encrypt_password
from schemas.datasets import (
    DatasetDetailResponse,
    DatasetSummaryResponse,
    ConnectDatabaseRequest,
    UploadSuccessResponse,
    MessageResponse,
)

router = APIRouter()

# ── Upload directory ──────────────────────────────────────────
UPLOAD_DIR = Path("./uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024   # 50 MB

ALLOWED_MIME_TYPES = {
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


# ════════════════════════════════════════════════════════════════
# UTILITIES
# ════════════════════════════════════════════════════════════════

def pandas_dtype_to_sql(dtype) -> str:
    """Map pandas dtype to a clean SQL type label."""
    s = str(dtype)
    if "int"      in s: return "INTEGER"
    if "float"    in s: return "FLOAT"
    if "bool"     in s: return "BOOLEAN"
    if "datetime" in s: return "TIMESTAMP"
    return "TEXT"


def read_file_to_dataframes(file_path: Path, table_name: Optional[str] = None) -> dict:
    """
    Read CSV or Excel into {table_name: DataFrame}.
    For CSV: uses table_name parameter (dataset_name) instead of
    file_path.stem which would be a UUID (the safe filename).
    Excel returns one entry per sheet.
    """
    suffix = file_path.suffix.lower()

    if suffix == ".csv":
        for encoding in ("utf-8", "latin-1", "cp1252"):
            try:
                df = pd.read_csv(file_path, encoding=encoding)
                name = table_name or file_path.stem
                return {name: df}
            except UnicodeDecodeError:
                continue
        raise ValueError("Could not decode CSV file — unsupported encoding")

    elif suffix in (".xlsx", ".xls"):
        try:
            with pd.ExcelFile(file_path) as xf:
                return {
                    sheet: pd.read_excel(file_path, sheet_name=sheet)
                    for sheet in xf.sheet_names
                }
        except Exception as e:
            raise ValueError(f"Failed to read Excel file: {e}")

    raise ValueError("Unsupported file type")


def save_schema_to_db(
    db: Session,
    dataset_id: uuid.UUID,
    dataframes: dict,
) -> None:
    """
    Persist DatasetTable + DatasetColumn rows for every
    sheet/table in dataframes. Skips truly empty sheets.
    Caller is responsible for commit().
    """
    for table_name, df in dataframes.items():
        # Skip completely empty sheets
        if df.empty and len(df.columns) == 0:
            continue

        tbl = DatasetTable(
            dataset_id=dataset_id,
            table_name=table_name,
            row_count=len(df),
        )
        db.add(tbl)
        db.flush()  # populate tbl.id

        for col in df.columns:
            dtype       = df[col].dtype
            data_type   = pandas_dtype_to_sql(dtype)
            is_nullable = bool(df[col].isnull().any())

            # For TEXT columns — store up to 10 distinct sample values
            # This helps the AI generate accurate WHERE conditions
            sample_values = None
            if data_type == "TEXT":
                try:
                    distinct = df[col].dropna().unique()[:10]
                    samples  = [str(v).strip() for v in distinct if str(v).strip()]
                    if samples:
                        sample_values = ", ".join([samples[i] for i in range(min(10, len(samples)))])
                except Exception:
                    pass

            db.add(DatasetColumn(
                table_id=tbl.id,
                column_name=str(col),
                data_type=data_type,
                is_nullable=is_nullable,
                sample_values=sample_values,
            ))


def validate_uuid(value: str, label: str = "ID") -> uuid.UUID:
    """Parse a string into UUID — raises clean 400 on bad format."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label} format",
        )


def get_dataset_or_404(
    db: Session,
    dataset_id: str,
    user_id: uuid.UUID,
) -> Dataset:
    """
    Fetch a Dataset by ID.
    Raises 400 on bad UUID, 404 if not found, 403 if wrong owner.
    """
    uid = validate_uuid(dataset_id, "dataset ID")
    ds  = db.query(Dataset).filter(Dataset.id == uid).first()

    if not ds:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found",
        )
    if ds.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return ds


def build_connection_string(req: ConnectDatabaseRequest) -> str:
    """Build SQLAlchemy connection string from user input."""
    if req.db_type == "postgresql":
        return (
            f"postgresql://{req.username}:{req.password}"
            f"@{req.host}:{req.port}/{req.database}"
        )
    return (
        f"mysql+pymysql://{req.username}:{req.password}"
        f"@{req.host}:{req.port}/{req.database}"
    )


# ════════════════════════════════════════════════════════════════
# POST /datasets/upload
# ════════════════════════════════════════════════════════════════
@router.post(
    "/upload",
    response_model=UploadSuccessResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a CSV or Excel file",
)
def upload_dataset(
    dataset_name: str        = Form(...),
    description:  str        = Form(None),
    file:         UploadFile = File(...),
    current_user: User       = Depends(get_current_user),
    db:           Session    = Depends(get_db),
):
    """
    Accepts CSV or Excel (max 50MB).
    Reads file in 1MB chunks — memory efficient.
    Auto-detects all columns and data types.
    Saves schema to dataset_tables + dataset_columns.
    """
    # Validate and sanitize dataset name
    dataset_name = re.sub(r'[^a-zA-Z0-9_]', '_', dataset_name.strip()).strip('_')
    if not dataset_name:
        uuid_hex = uuid.uuid4().hex
        dataset_name = f"dataset_{''.join(uuid_hex[i] for i in range(min(8, len(uuid_hex))))}"
    if len(dataset_name) < 3:
        raise HTTPException(400, "Dataset name must be at least 3 characters")
    if len(dataset_name) > 100:
        raise HTTPException(400, "Dataset name is too long (max 100 characters)")

    # Validate file presence
    if not file.filename:
        raise HTTPException(400, "Uploaded file has no filename")

    # Validate MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    # Validate extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Extension '{file_ext}' not allowed. Use .csv .xlsx .xls")

    # Save file in chunks — memory safe
    safe_name = f"{uuid.uuid4()}{file_ext}"
    file_path = UPLOAD_DIR / safe_name
    size = 0

    try:
        with open(file_path, "wb") as f:
            while chunk := file.file.read(1024 * 1024):  # 1MB chunks
                size += len(chunk)
                if size > MAX_FILE_SIZE_BYTES:
                    file_path.unlink(missing_ok=True)    # clean up partial file
                    raise HTTPException(413, "File exceeds the 50MB size limit")
                f.write(chunk)
    finally:
        file.file.close()   # always release file handle

    # Parse file into dataframes
    try:
        dataframes = read_file_to_dataframes(file_path, table_name=dataset_name)
    except ValueError as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(422, str(e))

    if not dataframes:
        file_path.unlink(missing_ok=True)
        raise HTTPException(422, "File is empty or could not be read")

    # Save to database in one transaction
    dataset = Dataset(
        user_id=current_user.id,
        dataset_name=dataset_name,
        dataset_type="csv" if file_ext == ".csv" else "excel",
        file_path=str(file_path),
        description=description,
    )

    try:
        db.add(dataset)
        db.flush()                                     # get dataset.id
        save_schema_to_db(db, dataset.id, dataframes)
        db.commit()
        db.refresh(dataset)                            # reload with relationships
    except Exception:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise HTTPException(500, "Failed to save dataset. Please try again.")

    # Generate profile + suggested questions (non-blocking: failures don't crash upload)
    profile = None
    suggested_questions = None
    try:
        profile = generate_profile(dataframes)
    except Exception:
        pass
    try:
        suggested_questions = generate_suggested_questions(dataset)
        if suggested_questions:
            dataset.suggested_questions = suggested_questions
            db.commit()
    except Exception:
        db.rollback()

    return {
        "message":             f"'{dataset_name}' uploaded successfully",
        "dataset_id":          dataset.id,
        "tables":              dataset.tables,
        "profile":             profile,
        "suggested_questions": suggested_questions,
    }


# ════════════════════════════════════════════════════════════════
# POST /datasets/connect-db
# ════════════════════════════════════════════════════════════════
@router.post(
    "/connect-db",
    response_model=UploadSuccessResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Connect an external PostgreSQL or MySQL database",
)
def connect_database(
    body:         ConnectDatabaseRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Tests the connection, reads all tables and columns from the
    external database, and stores the schema locally.
    Password is NEVER saved — only host/port/db/username.
    """
    conn_string = build_connection_string(body)

    # Test connection with 10s timeout
    try:
        ext_engine = create_engine(
            conn_string,
            connect_args={"connect_timeout": 10},
            pool_pre_ping=True,
        )
        with ext_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HTTPException(400, f"Connection failed: {e}")

    # Read schema from external DB
    try:
        inspector   = inspect(ext_engine)
        table_names = inspector.get_table_names()
    except Exception as e:
        raise HTTPException(500, f"Could not read schema: {e}")

    if not table_names:
        raise HTTPException(422, "Connected but no tables found in the database")

    # Store connection info — password encrypted safely using AES Fernet
    safe_conn = {
        "db_type":  body.db_type,
        "host":     body.host,
        "port":     body.port,
        "username": body.username,
        "database": body.database,
        "password": encrypt_password(body.password),
    }

    dataset = Dataset(
        user_id=current_user.id,
        dataset_name=body.dataset_name.strip(),
        dataset_type="database",
        database_connection=safe_conn,
        description=body.description,
    )

    try:
        db.add(dataset)
        db.flush()

        for tbl_name in table_names:
            # Get row count safely
            try:
                with ext_engine.connect() as conn:
                    quoted    = ext_engine.dialect.identifier_preparer.quote(tbl_name)
                    row_count = conn.execute(
                        text(f"SELECT COUNT(*) FROM {quoted}")
                    ).scalar()
            except Exception:
                row_count = None

            tbl = DatasetTable(
                dataset_id=dataset.id,
                table_name=tbl_name,
                row_count=row_count,
            )
            db.add(tbl)
            db.flush()

            for col in inspector.get_columns(tbl_name):
                db.add(DatasetColumn(
                    table_id=tbl.id,
                    column_name=col["name"],
                    data_type=str(col["type"]),
                    is_nullable=col.get("nullable", True),
                ))

        db.commit()
        db.refresh(dataset)

    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to save schema. Please try again.")
    finally:
        # BUG FIX (MEDIUM): ext_engine was never disposed — left a connection
        # pool open for the external DB after the request completed.
        ext_engine.dispose()

    return {
        "message":    f"'{body.dataset_name}' connected successfully",
        "dataset_id": dataset.id,
        "tables":     dataset.tables,
    }


# ════════════════════════════════════════════════════════════════
# GET /datasets/
# ════════════════════════════════════════════════════════════════
@router.get(
    "/",
    response_model=List[DatasetSummaryResponse],
    summary="List all datasets for the logged-in user",
)
def list_datasets(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Returns all datasets with summary stats (table count, total rows)."""
    datasets = (
        db.query(Dataset)
        .filter(Dataset.user_id == current_user.id)
        .order_by(Dataset.created_at.desc())
        .all()
    )

    return [
        {
            "id":           ds.id,
            "dataset_name": ds.dataset_name,
            "dataset_type": ds.dataset_type,
            "description":  ds.description,
            "created_at":   ds.created_at,
            "table_count":  len(ds.tables),
            "total_rows":   sum(t.row_count or 0 for t in ds.tables),
        }
        for ds in datasets
    ]


# ════════════════════════════════════════════════════════════════
# GET /datasets/{dataset_id}
# ════════════════════════════════════════════════════════════════
@router.get(
    "/{dataset_id}",
    response_model=DatasetDetailResponse,
    summary="Get full details of a dataset including all tables and columns",
)
def get_dataset(
    dataset_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """Returns full dataset details including all tables and columns."""
    return get_dataset_or_404(db, dataset_id, current_user.id)


# ════════════════════════════════════════════════════════════════
# GET /datasets/{dataset_id}/profile
# ════════════════════════════════════════════════════════════════
@router.get(
    "/{dataset_id}/profile",
    summary="Get statistical profile of a dataset",
)
def get_dataset_profile(
    dataset_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Regenerates and returns the statistical profile for a dataset.
    Re-reads the file from disk and computes fresh stats.
    """
    ds = get_dataset_or_404(db, dataset_id, current_user.id)

    if not ds.file_path:
        raise HTTPException(422, "Dataset has no file — only file-based datasets support profiling")

    file_path = Path(ds.file_path)
    if not file_path.exists():
        raise HTTPException(404, "Dataset file not found on disk. Please re-upload.")

    # Use the table name from DB (not the UUID filename)
    table_name = ds.tables[0].table_name if ds.tables else ds.dataset_name
    try:
        dataframes = read_file_to_dataframes(file_path, table_name=table_name)
    except ValueError as e:
        raise HTTPException(422, str(e))

    profile = generate_profile(dataframes)
    return {
        "dataset_id":          str(ds.id),
        "dataset_name":        ds.dataset_name,
        "profile":             profile,
        "suggested_questions": ds.suggested_questions,
    }


# ════════════════════════════════════════════════════════════════
# GET /datasets/{dataset_id}/schema
# ════════════════════════════════════════════════════════════════
@router.get(
    "/{dataset_id}/schema",
    summary="Get dataset schema — used by AI for SQL generation",
)
def get_dataset_schema(
    dataset_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Returns structured schema that the AI uses to understand
    the dataset before writing SQL queries.
    """
    ds = get_dataset_or_404(db, dataset_id, current_user.id)

    return {
        "dataset_id":   str(ds.id),
        "dataset_name": ds.dataset_name,
        "dataset_type": ds.dataset_type,
        "tables": [
            {
                "table_name": t.table_name,
                "row_count":  t.row_count,
                "columns": [
                    {
                        "column_name": c.column_name,
                        "data_type":   c.data_type,
                        "is_nullable": c.is_nullable,
                    }
                    for c in t.columns
                ],
            }
            for t in ds.tables
        ],
    }


# ════════════════════════════════════════════════════════════════
# DELETE /datasets/{dataset_id}
# ════════════════════════════════════════════════════════════════
@router.delete(
    "/{dataset_id}",
    response_model=MessageResponse,
    summary="Delete a dataset and all associated data",
)
def delete_dataset(
    dataset_id:   str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Deletes the dataset and its physical file (if any).
    All tables, columns, sessions, queries are
    cascade-deleted automatically by PostgreSQL.
    """
    ds = get_dataset_or_404(db, dataset_id, current_user.id)

    # Delete physical file from disk
    if ds.file_path:
        p = Path(ds.file_path)
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass   # don't block DB deletion if file removal fails

    try:
        db.delete(ds)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to delete dataset. Please try again.")

    return {"message": "Dataset deleted successfully"}