"""
routers/documents.py — Document Upload & Q&A endpoints (PageIndex)

Endpoints:
  POST   /documents/upload        — Upload PDF, generate PageIndex tree
  GET    /documents/              — List user's documents
  GET    /documents/{id}          — Get document details + tree index
  POST   /documents/ask           — Ask question about a document
  GET    /documents/{id}/queries  — Get past Q&A queries for a document
  DELETE /documents/{id}          — Delete document + file from disk
"""

import uuid
from pathlib import Path

from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status

from database import get_db
from models import User, Document, DocumentQuery
from routers.auth import get_current_user
from services.document_processor import (
    generate_tree_index_safe,
    get_page_texts,
    get_page_count,
)
from services.document_qa import ask_document
from schemas.documents import (
    DocumentUploadResponse,
    DocumentSummaryResponse,
    DocumentDetailResponse,
    DocumentAskRequest,
    DocumentAskResponse,
    DocumentQueryResponse,
    MessageResponse,
)

router = APIRouter()

# ── Upload directory (shared with datasets) ───────────────────
UPLOAD_DIR = Path("./uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf"}
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_MIME_TYPES = {"application/pdf"}


# ── Utilities ─────────────────────────────────────────────────

def validate_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label} format",
        )


def get_document_or_404(
    db: Session,
    document_id: str,
    user_id: uuid.UUID,
) -> Document:
    uid = validate_uuid(document_id, "document ID")
    doc = db.query(Document).filter(Document.id == uid).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return doc


# ════════════════════════════════════════════════════════════════
# POST /documents/upload
# ════════════════════════════════════════════════════════════════
@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a PDF document and generate PageIndex tree",
)
def upload_document(
    document_name: str        = Form(...),
    file:          UploadFile = File(...),
    current_user:  User       = Depends(get_current_user),
    db:            Session    = Depends(get_db),
):
    """
    Accepts a PDF file (max 50MB).
    Generates a PageIndex tree structure for reasoning-based Q&A.
    """
    # Validate document name
    document_name = document_name.strip()
    if len(document_name) < 3:
        raise HTTPException(400, "Document name must be at least 3 characters")
    if len(document_name) > 200:
        raise HTTPException(400, "Document name is too long (max 200 characters)")

    # Validate file
    if not file.filename:
        raise HTTPException(400, "Uploaded file has no filename")

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Only PDF files are allowed. Got: {file_ext}")

    if file.content_type and file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    # Save file in chunks — memory safe
    safe_name = f"{uuid.uuid4()}{file_ext}"
    file_path = UPLOAD_DIR / safe_name
    size = 0

    try:
        with open(file_path, "wb") as f:
            while chunk := file.file.read(1024 * 1024):  # 1MB chunks
                size += len(chunk)
                if size > MAX_FILE_SIZE_BYTES:
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(413, "File exceeds the 50MB size limit")
                f.write(chunk)
    finally:
        file.file.close()

    # Get page count
    try:
        page_count = get_page_count(str(file_path))
    except Exception:
        page_count = None

    # Create document record (status=processing)
    document = Document(
        user_id=current_user.id,
        document_name=document_name,
        file_path=str(file_path),
        page_count=page_count,
        status="processing",
    )

    try:
        db.add(document)
        db.commit()
        db.refresh(document)
    except Exception:
        db.rollback()
        file_path.unlink(missing_ok=True)
        raise HTTPException(500, "Failed to save document. Please try again.")

    # Generate tree index (synchronous — may take 30-120s for large PDFs)
    tree_index, error = generate_tree_index_safe(str(file_path))

    if error:
        document.status = "failed"
        document.error_message = error
    else:
        document.status = "ready"
        document.tree_index = tree_index

    try:
        db.commit()
        db.refresh(document)
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to update document status.")

    return {
        "message":       f"'{document_name}' uploaded successfully" if document.status == "ready"
                         else f"'{document_name}' upload failed: {error}",
        "document_id":   document.id,
        "document_name": document.document_name,
        "status":        document.status,
        "page_count":    document.page_count,
        "tree_index":    document.tree_index,
    }


# ════════════════════════════════════════════════════════════════
# GET /documents/
# ════════════════════════════════════════════════════════════════
@router.get(
    "/",
    response_model=list[DocumentSummaryResponse],
    summary="List all documents for the logged-in user",
)
def list_documents(
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    docs = (
        db.query(Document)
        .filter(Document.user_id == current_user.id)
        .order_by(Document.created_at.desc())
        .all()
    )
    return [
        {
            "id":            doc.id,
            "document_name": doc.document_name,
            "page_count":    doc.page_count,
            "status":        doc.status,
            "query_count":   len(doc.queries),
            "created_at":    doc.created_at,
        }
        for doc in docs
    ]


# ════════════════════════════════════════════════════════════════
# GET /documents/{document_id}
# ════════════════════════════════════════════════════════════════
@router.get(
    "/{document_id}",
    response_model=DocumentDetailResponse,
    summary="Get full details of a document including tree index",
)
def get_document(
    document_id:  str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    doc = get_document_or_404(db, document_id, current_user.id)
    return doc


# ════════════════════════════════════════════════════════════════
# POST /documents/ask
# ════════════════════════════════════════════════════════════════
@router.post(
    "/ask",
    response_model=DocumentAskResponse,
    summary="Ask a question about an uploaded document",
)
def ask_document_endpoint(
    body:         DocumentAskRequest,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Reasoning-based document Q&A:
    1. Navigates the PageIndex tree to find relevant sections
    2. Extracts text from those pages
    3. Generates answer using LLM
    """
    doc = get_document_or_404(db, body.document_id, current_user.id)

    if doc.status != "ready":
        raise HTTPException(
            422,
            f"Document is not ready for Q&A (status: {doc.status}). "
            + (f"Error: {doc.error_message}" if doc.error_message else "")
        )

    if not doc.tree_index:
        raise HTTPException(422, "Document has no tree index — cannot perform Q&A")

    if not doc.file_path:
        raise HTTPException(422, "Document file path missing")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(404, "Document file not found on disk. Please re-upload.")

    # Extract page texts
    try:
        page_texts = get_page_texts(str(file_path))
    except Exception as e:
        raise HTTPException(500, f"Failed to extract text from PDF: {str(e)}")

    # Run Q&A pipeline
    try:
        result = ask_document(
            tree_index=doc.tree_index,
            page_texts=page_texts,
            question=body.question,
        )
    except Exception as e:
        raise HTTPException(500, f"Q&A failed: {str(e)}")

    # Save query to DB
    try:
        query_record = DocumentQuery(
            document_id=doc.id,
            user_query=body.question,
            retrieved_pages=result.get("retrieved_pages"),
            answer=result.get("answer"),
            confidence_score=result.get("confidence_score"),
        )
        db.add(query_record)
        db.commit()
    except Exception:
        db.rollback()
        # Don't fail the response if DB save fails

    return {
        "question":         body.question,
        "answer":           result.get("answer", ""),
        "retrieved_pages":  result.get("retrieved_pages"),
        "confidence_score": result.get("confidence_score"),
    }


# ════════════════════════════════════════════════════════════════
# GET /documents/{document_id}/queries
# ════════════════════════════════════════════════════════════════
@router.get(
    "/{document_id}/queries",
    response_model=list[DocumentQueryResponse],
    summary="Get past Q&A queries for a document",
)
def get_document_queries(
    document_id:  str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    doc = get_document_or_404(db, document_id, current_user.id)
    return sorted(doc.queries, key=lambda q: q.created_at, reverse=True)


# ════════════════════════════════════════════════════════════════
# DELETE /documents/{document_id}
# ════════════════════════════════════════════════════════════════
@router.delete(
    "/{document_id}",
    response_model=MessageResponse,
    summary="Delete a document and all associated data",
)
def delete_document(
    document_id:  str,
    current_user: User    = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    doc = get_document_or_404(db, document_id, current_user.id)

    # Delete physical file from disk
    if doc.file_path:
        p = Path(doc.file_path)
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    try:
        db.delete(doc)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(500, "Failed to delete document. Please try again.")

    return {"message": "Document deleted successfully"}
