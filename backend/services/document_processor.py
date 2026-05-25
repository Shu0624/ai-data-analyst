"""
services/document_processor.py — PDF → PageIndex tree structure

Wraps the PageIndex library to:
1. Extract text from PDF pages via PyMuPDF
2. Generate a hierarchical tree index from the PDF

The tree index is a nested JSON structure (like a smart table-of-contents)
that the Q&A service navigates via LLM reasoning to find answers.
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional

import pymupdf  # PyMuPDF
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("app.document_processor")

PAGEINDEX_MODEL = os.getenv("PAGEINDEX_MODEL", f"groq/{os.getenv('GROQ_MODEL', 'llama-3.1-8b-instant')}")


def get_page_texts(pdf_path: str) -> list[str]:
    """
    Extract text from every page of a PDF using PyMuPDF.
    Returns a list where index i = text of page i+1.
    """
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    texts = []
    doc = pymupdf.open(str(path))
    try:
        for page in doc:
            texts.append(page.get_text("text"))
    finally:
        doc.close()
    return texts


def get_page_count(pdf_path: str) -> int:
    """Return the number of pages in a PDF."""
    doc = pymupdf.open(str(pdf_path))
    try:
        return len(doc)
    finally:
        doc.close()


def generate_tree_index(pdf_path: str, model: str = None) -> dict:
    """
    Generate a PageIndex tree structure from a PDF file.

    This calls PageIndex's page_index_main() which:
    1. Detects table of contents in the PDF
    2. Builds a hierarchical tree of sections
    3. Maps sections to page ranges
    4. Optionally adds summaries and node IDs

    Returns the tree structure as a dict/list.
    """
    import sys
    from pathlib import Path
    
    pageindex_clone_path = str((Path(__file__).parent.parent / "PageIndex_clone").resolve())
    if pageindex_clone_path not in sys.path:
        sys.path.append(pageindex_clone_path)

    from pageindex import page_index_main
    from pageindex.utils import ConfigLoader

    model = model or PAGEINDEX_MODEL

    # Configure PageIndex options
    user_opt = {
        "model": model,
        "if_add_node_id": "yes",
        "if_add_node_summary": "yes",
        "if_add_doc_description": "yes",
        "if_add_node_text": "no",
    }
    opt = ConfigLoader().load(
        {k: v for k, v in user_opt.items() if v is not None}
    )

    logger.info(f"Generating PageIndex tree for: {pdf_path} (model={model})")
    tree = page_index_main(pdf_path, opt)
    logger.info(f"PageIndex tree generated successfully")

    return tree


def generate_tree_index_safe(pdf_path: str, model: str = None) -> tuple[Optional[dict], Optional[str]]:
    """
    Safe wrapper around generate_tree_index.
    Returns (tree_index, error_message).
    On success: (tree, None)
    On failure: (None, error_string)
    """
    try:
        tree = generate_tree_index(pdf_path, model)
        return tree, None
    except Exception as e:
        error = f"Failed to generate tree index: {str(e)}"
        logger.error(error, exc_info=True)
        return None, error
