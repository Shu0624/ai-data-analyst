"""
services/document_qa.py — Reasoning-based Document Q&A via PageIndex tree search

Implements the core Q&A pipeline:
1. Tree Search — LLM navigates the hierarchical tree index to find relevant sections
2. Page Retrieval — Extracts text from the pages identified by tree search
3. Answer Generation — LLM generates answer using retrieved context + question

This is the "vectorless RAG" approach: no embeddings, no vector DB,
just LLM reasoning over a structured document index.
"""

import os
import json
import logging
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("app.document_qa")

# Use Groq for Q&A (fast + cheap), but allow override
QA_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")


def _call_llm(messages: list, max_tokens: int = 1024, temperature: float = 0.1) -> str:
    """
    Call LLM for Q&A. Uses the existing Groq client from services/utils.py
    to stay consistent with the rest of the project.
    """
    from services.utils import call_groq
    return call_groq(messages, max_tokens=max_tokens, temperature=temperature)


def tree_search(tree_index: dict | list, question: str, page_texts: list[str]) -> list[dict]:
    """
    Navigate the PageIndex tree structure using LLM reasoning to find
    the most relevant sections for a given question.

    Algorithm:
    1. Present top-level nodes to LLM
    2. LLM picks the most relevant node(s)
    3. If selected node has children → recurse
    4. If leaf node → return its page range
    5. Collect all relevant page ranges

    Returns list of dicts: [{"title": ..., "start_page": ..., "end_page": ..., "summary": ...}]
    """
    # Normalize tree_index to a list of nodes
    if isinstance(tree_index, dict):
        nodes = tree_index.get("nodes", [tree_index])
        # If the tree_index itself is a single root node
        if "title" in tree_index and "nodes" not in tree_index:
            nodes = [tree_index]
        elif "title" in tree_index:
            nodes = tree_index.get("nodes", [])
            # Include the root if it has page range info
            if not nodes:
                nodes = [tree_index]
    elif isinstance(tree_index, list):
        nodes = tree_index
    else:
        logger.warning(f"Unexpected tree_index type: {type(tree_index)}")
        return []

    if not nodes:
        return []

    return _search_nodes(nodes, question, max_depth=5)


def _search_nodes(nodes: list, question: str, max_depth: int = 5, depth: int = 0) -> list[dict]:
    """
    Recursively search nodes for relevant sections.
    """
    if depth >= max_depth or not nodes:
        return []

    # Build a summary of available sections for the LLM
    sections_desc = []
    for i, node in enumerate(nodes):
        title = node.get("title", f"Section {i+1}")
        summary = node.get("summary", "")
        start = node.get("start_index", "?")
        end = node.get("end_index", "?")
        has_children = bool(node.get("nodes"))

        desc = f"{i+1}. \"{title}\" (pages {start}-{end})"
        if summary:
            desc += f" — {summary[:150]}"
        sections_desc.append(desc)

    sections_text = "\n".join(sections_desc)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a document navigation expert. Given a user's question and a list of "
                "document sections, identify which sections are most likely to contain the answer.\n\n"
                "RULES:\n"
                "- Return a JSON array of section numbers (1-indexed) that are relevant.\n"
                "- Select 1-3 most relevant sections only.\n"
                "- If no sections seem relevant, return an empty array [].\n"
                "- Reply with ONLY the JSON array, nothing else.\n\n"
                "Example: [1, 3]"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\n"
                f"Available sections:\n{sections_text}"
            ),
        },
    ]

    try:
        response = _call_llm(messages, max_tokens=50, temperature=0.0)
        # Parse the selected section indices
        import re
        match = re.search(r"\[.*?\]", response, re.DOTALL)
        if not match:
            # Fallback: return first node's pages
            return _extract_pages_from_nodes(nodes[:1])

        selected_indices = json.loads(match.group())
        if not isinstance(selected_indices, list):
            return _extract_pages_from_nodes(nodes[:1])

        # Convert to 0-indexed and filter valid
        selected = []
        for idx in selected_indices:
            if isinstance(idx, int) and 1 <= idx <= len(nodes):
                selected.append(nodes[idx - 1])

        if not selected:
            return _extract_pages_from_nodes(nodes[:1])

        # For each selected node: recurse if has children, else return pages
        results = []
        for node in selected:
            children = node.get("nodes", [])
            if children and depth < max_depth - 1:
                # Recurse into children
                child_results = _search_nodes(children, question, max_depth, depth + 1)
                if child_results:
                    results.extend(child_results)
                else:
                    # Children didn't yield results, use this node's pages
                    results.extend(_extract_pages_from_nodes([node]))
            else:
                results.extend(_extract_pages_from_nodes([node]))

        return results

    except Exception as e:
        logger.error(f"Tree search error at depth {depth}: {e}")
        # Fallback: return first node's pages
        return _extract_pages_from_nodes(nodes[:1])


def _extract_pages_from_nodes(nodes: list) -> list[dict]:
    """Extract page info from leaf nodes."""
    results = []
    for node in nodes:
        start = node.get("start_index")
        end = node.get("end_index")
        if start is not None and end is not None:
            results.append({
                "title": node.get("title", "Untitled"),
                "start_page": start,
                "end_page": end,
                "summary": node.get("summary", ""),
                "node_id": node.get("node_id", ""),
            })
    return results


def answer_question(
    question: str,
    page_texts: list[str],
    relevant_pages: list[dict],
) -> dict:
    """
    Generate an answer using the retrieved page texts.

    Args:
        question: User's question
        page_texts: All page texts (0-indexed)
        relevant_pages: Pages found by tree_search

    Returns:
        {"answer": str, "confidence_score": float, "retrieved_pages": list}
    """
    if not relevant_pages:
        return {
            "answer": "I couldn't find relevant sections in the document to answer your question.",
            "confidence_score": 0.0,
            "retrieved_pages": [],
        }

    # Collect text from relevant pages (cap at ~8000 chars to stay within context)
    context_parts = []
    total_chars = 0
    MAX_CONTEXT_CHARS = 8000

    for page_info in relevant_pages:
        start = page_info.get("start_page", 0)
        end = page_info.get("end_page", start)

        # PageIndex uses 1-indexed pages, page_texts is 0-indexed
        for page_num in range(max(0, start - 1), min(len(page_texts), end)):
            text = page_texts[page_num].strip()
            if not text:
                continue
            if total_chars + len(text) > MAX_CONTEXT_CHARS:
                # Truncate to fit
                remaining = MAX_CONTEXT_CHARS - total_chars
                if remaining > 200:
                    text = text[:remaining] + "..."
                    context_parts.append(f"[Page {page_num + 1}]\n{text}")
                break
            context_parts.append(f"[Page {page_num + 1}]\n{text}")
            total_chars += len(text)

    if not context_parts:
        return {
            "answer": "The relevant pages appear to be empty or could not be extracted.",
            "confidence_score": 0.1,
            "retrieved_pages": relevant_pages,
        }

    context = "\n\n---\n\n".join(context_parts)

    # Section summaries for extra context
    section_info = "\n".join(
        f"- {p['title']} (pages {p['start_page']}-{p['end_page']}): {p.get('summary', '')[:100]}"
        for p in relevant_pages
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a document analysis expert. Answer the user's question based ONLY on "
                "the provided document context. Be specific, accurate, and cite page numbers.\n\n"
                "RULES:\n"
                "- Base your answer ONLY on the provided document text.\n"
                "- If the answer is not in the provided context, say so clearly.\n"
                "- Cite specific page numbers when referencing information.\n"
                "- Be concise but thorough.\n"
                "- At the end, rate your confidence (0.0-1.0) in the answer.\n\n"
                "Format:\n"
                "Answer: <your answer>\n"
                "Confidence: <0.0-1.0>"
            ),
        },
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\n"
                f"Relevant sections found:\n{section_info}\n\n"
                f"Document context:\n{context}"
            ),
        },
    ]

    try:
        response = _call_llm(messages, max_tokens=1024, temperature=0.2)

        # Parse confidence score from response
        confidence = 0.5
        answer = response

        import re
        conf_match = re.search(r"[Cc]onfidence:\s*([\d.]+)", response)
        if conf_match:
            try:
                confidence = float(conf_match.group(1))
                confidence = max(0.0, min(1.0, confidence))
            except ValueError:
                pass
            # Remove confidence line from answer
            answer = re.sub(r"\n*[Cc]onfidence:\s*[\d.]+\s*$", "", response).strip()

        # Clean up "Answer:" prefix if present
        if answer.lower().startswith("answer:"):
            answer = answer[7:].strip()

        return {
            "answer": answer,
            "confidence_score": round(confidence, 2),
            "retrieved_pages": relevant_pages,
        }

    except Exception as e:
        logger.error(f"Answer generation error: {e}")
        return {
            "answer": f"Error generating answer: {str(e)}",
            "confidence_score": 0.0,
            "retrieved_pages": relevant_pages,
        }


def ask_document(
    tree_index: dict | list,
    page_texts: list[str],
    question: str,
) -> dict:
    """
    Full Q&A pipeline:
    1. Tree search to find relevant sections
    2. Extract page texts from relevant sections
    3. Generate answer using LLM

    Args:
        tree_index: PageIndex tree structure (from DB)
        page_texts: All page texts extracted from PDF
        question: User's question

    Returns:
        {"answer": str, "confidence_score": float, "retrieved_pages": list}
    """
    logger.info(f"Document Q&A: '{question[:60]}...'")

    # Step 1: Tree search
    relevant_pages = tree_search(tree_index, question, page_texts)
    logger.info(f"Tree search found {len(relevant_pages)} relevant sections")

    # Step 2+3: Generate answer from retrieved pages
    result = answer_question(question, page_texts, relevant_pages)
    logger.info(f"Answer generated (confidence={result['confidence_score']})")

    return result
