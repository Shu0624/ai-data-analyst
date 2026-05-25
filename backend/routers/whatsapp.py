"""
routers/whatsapp.py — WhatsApp Webhook & Client/Lead Management

Endpoints:
  GET    /whatsapp/webhook          — Meta webhook verification
  POST   /whatsapp/webhook          — Receive incoming WhatsApp messages
  POST   /whatsapp/clients          — Create a new business client
  GET    /whatsapp/clients          — List all clients
  GET    /whatsapp/clients/{id}     — Get client details
  PUT    /whatsapp/clients/{id}     — Update client
  GET    /whatsapp/clients/{id}/leads    — Get leads for a client
  GET    /whatsapp/clients/{id}/analytics — Get client analytics
  GET    /whatsapp/leads/{id}       — Get lead details with messages
  PUT    /whatsapp/leads/{id}       — Update lead status/info
  POST   /whatsapp/test-send        — Test send a message (dev only)

The webhook is the heart of the system:
  1. Customer sends message on WhatsApp
  2. Meta calls POST /whatsapp/webhook
  3. We find the Client by their WhatsApp number
  4. We find or create a Lead for the customer
  5. We route to AI (Document Q&A or LLM) for response
  6. We send the reply back via WhatsApp Cloud API
"""

import uuid
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, Request, Query, status
from fastapi.responses import PlainTextResponse

from database import get_db
from models import User, Document, Client, Lead, LeadMessage
from routers.auth import get_current_user
from services.whatsapp import (
    send_text_message,
    send_button_message,
    mark_as_read,
    WHATSAPP_VERIFY_TOKEN,
)
from schemas.whatsapp import (
    ClientCreate,
    ClientResponse,
    ClientUpdate,
    LeadResponse,
    LeadUpdate,
    LeadMessageResponse,
    ClientAnalytics,
    MessageResponse,
    WebhookMessage,
)

router = APIRouter()
logger = logging.getLogger("app.whatsapp")


# ════════════════════════════════════════════════════════════════
# UTILITIES
# ════════════════════════════════════════════════════════════════

def validate_uuid(value: str, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {label} format",
        )


def parse_webhook_message(data: dict) -> Optional[WebhookMessage]:
    """
    Parse the Meta webhook payload to extract the incoming message.
    Returns None if the payload is not a message event (e.g. status update).
    """
    try:
        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})

        messages = value.get("messages", [])
        if not messages:
            return None

        msg = messages[0]
        contacts = value.get("contacts", [{}])
        profile_name = contacts[0].get("profile", {}).get("name") if contacts else None

        # Extract message content based on type
        msg_type = msg.get("type", "text")
        text = None
        button_id = None
        button_text = None

        if msg_type == "text":
            text = msg.get("text", {}).get("body", "")
        elif msg_type == "interactive":
            interactive = msg.get("interactive", {})
            ir_type = interactive.get("type", "")
            if ir_type == "button_reply":
                reply = interactive.get("button_reply", {})
                button_id = reply.get("id", "")
                button_text = reply.get("title", "")
                text = button_text
            elif ir_type == "list_reply":
                reply = interactive.get("list_reply", {})
                button_id = reply.get("id", "")
                button_text = reply.get("title", "")
                text = button_text
        elif msg_type == "image":
            text = msg.get("image", {}).get("caption", "[Image received]")
        elif msg_type == "audio":
            text = "[Voice message received]"
        elif msg_type == "document":
            text = "[Document received]"

        return WebhookMessage(
            message_id=msg.get("id", ""),
            from_phone=msg.get("from", ""),
            timestamp=msg.get("timestamp", ""),
            message_type=msg_type,
            text=text,
            button_id=button_id,
            button_text=button_text,
            profile_name=profile_name,
        )
    except Exception as e:
        logger.error(f"Failed to parse webhook: {e}")
        return None


def generate_ai_reply(
    client: Client,
    lead: Lead,
    message_text: str,
    db: Session,
) -> str:
    """
    Generate an AI-powered reply using the existing AI engine.
    
    Priority:
    1. If client has a FAQ document → use PageIndex Document Q&A
    2. Else → use Groq LLM with niche-specific prompt
    """
    # ── Try Document Q&A first ────────────────────────────────
    if client.document_id and client.document:
        doc = client.document
        if doc.status == "ready" and doc.tree_index and doc.file_path:
            file_path = Path(doc.file_path)
            if file_path.exists():
                try:
                    from services.document_processor import get_page_texts
                    from services.document_qa import ask_document

                    page_texts = get_page_texts(str(file_path))
                    result = ask_document(
                        tree_index=doc.tree_index,
                        page_texts=page_texts,
                        question=message_text,
                    )
                    answer = result.get("answer", "")
                    confidence = result.get("confidence_score", 0)

                    if answer and confidence >= 0.3:
                        return answer
                except Exception as e:
                    logger.error(f"Document Q&A failed: {e}")

    # ── Fallback: Groq LLM with niche context ────────────────
    try:
        from services.utils import call_groq

        niche_context = {
            "gym": "a gym/fitness center. Help with membership plans, timings, facilities, free trials, and trainer info.",
            "coaching": "a coaching institute/classes. Help with course details, fees, schedules, batches, and admission process.",
            "clinic": "a doctor's clinic. Help with appointment booking, doctor availability, services offered, and visiting hours.",
            "realestate": "a real estate business. Help with property details, pricing, site visits, EMI options, and availability.",
            "d2c": "an online brand/shop. Help with product info, pricing, order status, shipping, returns, and offers.",
            "education": "an educational institution. Help with courses, admissions, fees, and campus information.",
            "event": "an event management company. Help with event packages, availability, and booking details.",
        }

        context = niche_context.get(client.niche, "a business. Help answer customer queries professionally.")

        # Get last 3 messages for conversation context
        recent_msgs = (
            db.query(LeadMessage)
            .filter(LeadMessage.lead_id == lead.id)
            .order_by(LeadMessage.created_at.desc())
            .limit(6)
            .all()
        )
        recent_msgs.reverse()

        conversation_history = ""
        if recent_msgs:
            lines = []
            for m in recent_msgs:
                role = "Customer" if m.direction == "inbound" else "Business"
                lines.append(f"{role}: {m.message_text}")
            conversation_history = "\n".join(lines[-6:])

        customer_name = lead.name or "Customer"

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a helpful assistant for '{client.business_name}', which is {context}\n\n"
                    f"RULES:\n"
                    f"- Be friendly, professional, and concise (under 200 words).\n"
                    f"- Address the customer by name if known: {customer_name}\n"
                    f"- If asked about pricing or details you don't know, say you'll have someone get back to them.\n"
                    f"- Always try to move toward a booking/visit/purchase.\n"
                    f"- If the customer seems interested, suggest scheduling a call or visit.\n"
                    f"- Use emoji sparingly for warmth (1-2 per message max).\n"
                    f"- Reply in the same language the customer uses (Hindi/English/Hinglish).\n"
                    f"- NEVER say you are an AI. You are the business assistant.\n\n"
                    f"Conversation so far:\n{conversation_history}"
                ),
            },
            {
                "role": "user",
                "content": message_text,
            },
        ]

        reply = call_groq(messages, max_tokens=300, temperature=0.4)
        return reply.strip()

    except Exception as e:
        logger.error(f"LLM reply generation failed: {e}")
        return (
            f"Thank you for reaching out to {client.business_name}! "
            f"We've received your message and will get back to you shortly. 🙏"
        )


# ════════════════════════════════════════════════════════════════
# WEBHOOK — Meta Verification (GET)
# ════════════════════════════════════════════════════════════════

@router.get(
    "/webhook",
    summary="WhatsApp webhook verification (required by Meta)",
)
def verify_webhook(
    request: Request,
):
    """
    Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge.
    We verify the token and return the challenge to confirm the webhook.
    """
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode == "subscribe" and token == WHATSAPP_VERIFY_TOKEN:
        logger.info("WhatsApp webhook verified successfully")
        return PlainTextResponse(content=challenge, status_code=200)

    logger.warning(f"Webhook verification failed: mode={mode}, token={token}")
    raise HTTPException(403, "Verification failed")


# ════════════════════════════════════════════════════════════════
# WEBHOOK — Receive Messages (POST)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/webhook",
    summary="Receive incoming WhatsApp messages",
)
async def receive_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Core message handler:
    1. Parse incoming message
    2. Find the Client (business) this message is for
    3. Find or create the Lead (customer)
    4. Generate AI reply (Document Q&A or LLM)
    5. Send reply via WhatsApp
    6. Log everything
    """
    try:
        data = await request.json()
    except Exception:
        return {"status": "ok"}

    # Parse the message
    msg = parse_webhook_message(data)
    if not msg or not msg.text:
        return {"status": "ok"}  # Status update or empty — ignore

    logger.info(f"Incoming from {msg.from_phone}: {msg.text[:100]}")

    # ── Mark as read (blue ticks) ─────────────────────────────
    if msg.message_id:
        mark_as_read(msg.message_id)

    # ── Find the Client ───────────────────────────────────────
    # The WhatsApp number receiving the message = the business's WhatsApp number
    # Meta sends the business phone number in the metadata
    try:
        entry = data.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        business_phone = value.get("metadata", {}).get("display_phone_number", "")
        # Normalize: remove +, spaces, dashes
        business_phone = business_phone.replace("+", "").replace(" ", "").replace("-", "")
    except Exception:
        business_phone = ""

    # Try to find client by business phone number
    client = None
    if business_phone:
        client = (
            db.query(Client)
            .filter(Client.whatsapp_number == business_phone, Client.is_active == True)
            .first()
        )

    # If no client found by business phone, try finding any active client
    # (useful in single-business setup)
    if not client:
        client = db.query(Client).filter(Client.is_active == True).first()

    if not client:
        logger.warning(f"No active client found for business phone: {business_phone}")
        send_text_message(
            msg.from_phone,
            "Thank you for your message! We're currently setting up our system. Please try again later. 🙏"
        )
        return {"status": "ok"}

    # ── Find or create Lead ───────────────────────────────────
    lead = (
        db.query(Lead)
        .filter(Lead.client_id == client.id, Lead.phone == msg.from_phone)
        .first()
    )

    if not lead:
        lead = Lead(
            client_id=client.id,
            phone=msg.from_phone,
            name=msg.profile_name,
            status="new",
            source="whatsapp",
        )
        db.add(lead)
        db.flush()
        logger.info(f"New lead created: {msg.from_phone} ({msg.profile_name})")

    # Update lead name if we have it from WhatsApp profile
    if msg.profile_name and not lead.name:
        lead.name = msg.profile_name

    lead.last_message_at = datetime.utcnow()

    # ── Save inbound message ──────────────────────────────────
    inbound_msg = LeadMessage(
        lead_id=lead.id,
        direction="inbound",
        message_text=msg.text,
        message_type=msg.message_type if msg.message_type != "interactive" else "button_reply",
        wa_message_id=msg.message_id,
    )
    db.add(inbound_msg)

    # ── Check for greeting → send welcome with buttons ────────
    greeting_words = {"hi", "hello", "hey", "hii", "hlo", "start", "menu"}
    is_greeting = msg.text.strip().lower() in greeting_words

    if is_greeting and lead.status == "new":
        # First-time greeting — send welcome with options
        greeting = client.greeting_message or (
            f"Welcome to {client.business_name}! 👋\n\n"
            f"How can we help you today?"
        )

        # Send interactive buttons based on niche
        niche_buttons = {
            "gym": [
                {"id": "membership", "title": "💪 Membership"},
                {"id": "trial", "title": "🎯 Free Trial"},
                {"id": "timings", "title": "🕐 Timings"},
            ],
            "coaching": [
                {"id": "courses", "title": "📚 Courses"},
                {"id": "fees", "title": "💰 Fee Details"},
                {"id": "schedule", "title": "📅 Schedule"},
            ],
            "clinic": [
                {"id": "appointment", "title": "📅 Book Appointment"},
                {"id": "services", "title": "🏥 Services"},
                {"id": "timings", "title": "🕐 Timings"},
            ],
            "realestate": [
                {"id": "properties", "title": "🏠 Properties"},
                {"id": "visit", "title": "📍 Site Visit"},
                {"id": "pricing", "title": "💰 Pricing"},
            ],
            "d2c": [
                {"id": "products", "title": "🛍 Products"},
                {"id": "offers", "title": "🎁 Offers"},
                {"id": "order_status", "title": "📦 Order Status"},
            ],
        }

        buttons = niche_buttons.get(client.niche, [
            {"id": "info", "title": "ℹ️ Info"},
            {"id": "contact", "title": "📞 Contact Us"},
            {"id": "help", "title": "❓ Help"},
        ])

        send_button_message(
            to_phone=msg.from_phone,
            body_text=greeting,
            buttons=buttons,
            footer=client.business_name,
        )

        # Log outbound message
        outbound_msg = LeadMessage(
            lead_id=lead.id,
            direction="outbound",
            message_text=greeting,
            message_type="button",
        )
        db.add(outbound_msg)
        lead.status = "contacted"

    else:
        # ── Generate AI reply ─────────────────────────────────
        reply_text = generate_ai_reply(client, lead, msg.text, db)

        # Send reply
        send_text_message(msg.from_phone, reply_text)

        # Log outbound message
        outbound_msg = LeadMessage(
            lead_id=lead.id,
            direction="outbound",
            message_text=reply_text,
            message_type="text",
        )
        db.add(outbound_msg)

        if lead.status == "new":
            lead.status = "contacted"

    # ── Commit all changes ────────────────────────────────────
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.error("Failed to commit webhook data")

    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════
# CLIENT MANAGEMENT
# ════════════════════════════════════════════════════════════════

@router.post(
    "/clients",
    response_model=ClientResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new business client",
)
def create_client(
    body: ClientCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register a new business client for WhatsApp automation."""
    # Check for duplicate WhatsApp number
    existing = db.query(Client).filter(Client.whatsapp_number == body.whatsapp_number).first()
    if existing:
        raise HTTPException(409, "This WhatsApp number is already registered")

    doc_id = None
    if body.document_id:
        doc_uuid = validate_uuid(body.document_id, "document ID")
        doc = db.query(Document).filter(Document.id == doc_uuid).first()
        if not doc:
            raise HTTPException(404, "Document not found")
        doc_id = doc_uuid

    client = Client(
        user_id=current_user.id,
        business_name=body.business_name,
        niche=body.niche,
        whatsapp_number=body.whatsapp_number,
        document_id=doc_id,
    )

    db.add(client)
    db.commit()
    db.refresh(client)

    return {
        **client.__dict__,
        "lead_count": 0,
    }


@router.get(
    "/clients",
    response_model=list[ClientResponse],
    summary="List all business clients",
)
def list_clients(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clients = (
        db.query(Client)
        .filter(Client.user_id == current_user.id)
        .order_by(Client.created_at.desc())
        .all()
    )
    return [
        {
            **c.__dict__,
            "lead_count": len(c.leads),
        }
        for c in clients
    ]


@router.get(
    "/clients/{client_id}",
    response_model=ClientResponse,
    summary="Get client details",
)
def get_client(
    client_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(client_id)
    client = db.query(Client).filter(Client.id == uid, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    return {
        **client.__dict__,
        "lead_count": len(client.leads),
    }


@router.put(
    "/clients/{client_id}",
    response_model=ClientResponse,
    summary="Update client settings",
)
def update_client(
    client_id: str,
    body: ClientUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(client_id)
    client = db.query(Client).filter(Client.id == uid, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    if body.business_name is not None:
        client.business_name = body.business_name
    if body.niche is not None:
        client.niche = body.niche
    if body.greeting_message is not None:
        client.greeting_message = body.greeting_message
    if body.is_active is not None:
        client.is_active = body.is_active
    if body.document_id is not None:
        doc_uuid = validate_uuid(body.document_id, "document ID")
        client.document_id = doc_uuid

    db.commit()
    db.refresh(client)
    return {
        **client.__dict__,
        "lead_count": len(client.leads),
    }


# ════════════════════════════════════════════════════════════════
# LEAD MANAGEMENT
# ════════════════════════════════════════════════════════════════

@router.get(
    "/clients/{client_id}/leads",
    response_model=list[LeadResponse],
    summary="Get all leads for a client",
)
def get_client_leads(
    client_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(client_id)
    client = db.query(Client).filter(Client.id == uid, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    query = db.query(Lead).filter(Lead.client_id == client.id)
    if status_filter:
        query = query.filter(Lead.status == status_filter)

    leads = query.order_by(Lead.created_at.desc()).all()

    return [
        {
            **l.__dict__,
            "message_count": len(l.messages),
        }
        for l in leads
    ]


@router.get(
    "/leads/{lead_id}",
    response_model=LeadResponse,
    summary="Get lead details",
)
def get_lead(
    lead_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(lead_id)
    lead = db.query(Lead).filter(Lead.id == uid).first()
    if not lead:
        raise HTTPException(404, "Lead not found")

    # Check ownership through client
    client = db.query(Client).filter(Client.id == lead.client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(403, "Access denied")

    return {
        **lead.__dict__,
        "message_count": len(lead.messages),
    }


@router.put(
    "/leads/{lead_id}",
    response_model=LeadResponse,
    summary="Update lead status or details",
)
def update_lead(
    lead_id: str,
    body: LeadUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(lead_id)
    lead = db.query(Lead).filter(Lead.id == uid).first()
    if not lead:
        raise HTTPException(404, "Lead not found")

    client = db.query(Client).filter(Client.id == lead.client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(403, "Access denied")

    if body.name is not None:
        lead.name = body.name
    if body.interest is not None:
        lead.interest = body.interest
    if body.status is not None:
        lead.status = body.status
    if body.lead_score is not None:
        lead.lead_score = body.lead_score

    db.commit()
    db.refresh(lead)
    return {
        **lead.__dict__,
        "message_count": len(lead.messages),
    }


@router.get(
    "/leads/{lead_id}/messages",
    response_model=list[LeadMessageResponse],
    summary="Get conversation history for a lead",
)
def get_lead_messages(
    lead_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(lead_id)
    lead = db.query(Lead).filter(Lead.id == uid).first()
    if not lead:
        raise HTTPException(404, "Lead not found")

    client = db.query(Client).filter(Client.id == lead.client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(403, "Access denied")

    return sorted(lead.messages, key=lambda m: m.created_at)


# ════════════════════════════════════════════════════════════════
# ANALYTICS
# ════════════════════════════════════════════════════════════════

@router.get(
    "/clients/{client_id}/analytics",
    response_model=ClientAnalytics,
    summary="Get lead analytics for a client",
)
def get_client_analytics(
    client_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    uid = validate_uuid(client_id)
    client = db.query(Client).filter(Client.id == uid, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    all_leads = db.query(Lead).filter(Lead.client_id == client.id).all()

    total = len(all_leads)
    today_count = sum(1 for l in all_leads if l.created_at >= today_start)
    week_count = sum(1 for l in all_leads if l.created_at >= week_start)

    # Leads by status
    status_counts = {}
    for l in all_leads:
        status_counts[l.status] = status_counts.get(l.status, 0) + 1

    # Top interests
    interest_counts = {}
    for l in all_leads:
        if l.interest:
            interest_counts[l.interest] = interest_counts.get(l.interest, 0) + 1

    top_interests = [
        {"interest": k, "count": v}
        for k, v in sorted(interest_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    # Conversion rate
    converted = status_counts.get("converted", 0)
    conversion_rate = round(converted / total * 100, 1) if total > 0 else 0

    return {
        "total_leads": total,
        "new_leads_today": today_count,
        "new_leads_week": week_count,
        "leads_by_status": status_counts,
        "conversion_rate": conversion_rate,
        "top_interests": top_interests,
    }


# ════════════════════════════════════════════════════════════════
# TEST ENDPOINT (Development only)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/test-send",
    response_model=MessageResponse,
    summary="Send a test WhatsApp message (dev only)",
)
def test_send(
    phone: str = Query(..., description="Phone number with country code"),
    message: str = Query("Hello from AI Data Analyst! 🤖", description="Message text"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a test message to verify WhatsApp API is working."""
    result = send_text_message(phone, message)
    if "error" in result:
        raise HTTPException(500, f"Send failed: {result['error']}")
    return {"message": f"Test message sent to {phone}"}
