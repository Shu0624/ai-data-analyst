"""
services/whatsapp.py — WhatsApp Cloud API message sending service

Handles:
  - Sending text replies
  - Sending template messages (for business-initiated conversations)
  - Sending interactive button/list messages
  - Sending image messages (for chart screenshots)
  - Message status tracking

Uses Meta WhatsApp Cloud API v21.0
"""

import os
import json
import logging
import urllib.request
import urllib.error
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("app.whatsapp")

# ── Config ────────────────────────────────────────────────────
WHATSAPP_API_VERSION    = "v21.0"
WHATSAPP_PHONE_ID       = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
WHATSAPP_ACCESS_TOKEN   = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_VERIFY_TOKEN   = os.getenv("WHATSAPP_VERIFY_TOKEN", "whatsapp_verify_token_2025")

BASE_URL = f"https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_ID}/messages"


def _send_request(payload: dict) -> dict:
    """
    Send a request to the WhatsApp Cloud API.
    Returns the API response as a dict.
    Raises on HTTP errors.
    """
    if not WHATSAPP_PHONE_ID or not WHATSAPP_ACCESS_TOKEN:
        logger.warning("WhatsApp credentials not configured — message not sent")
        return {"error": "WhatsApp not configured"}

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            response_data = json.loads(resp.read().decode("utf-8"))
            logger.info(f"WhatsApp message sent successfully: {response_data}")
            return response_data
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        logger.error(f"WhatsApp API error ({e.code}): {error_body}")
        return {"error": error_body, "status_code": e.code}
    except Exception as e:
        logger.error(f"WhatsApp send failed: {e}")
        return {"error": str(e)}


# ════════════════════════════════════════════════════════════════
# TEXT MESSAGES
# ════════════════════════════════════════════════════════════════

def send_text_message(to_phone: str, text: str) -> dict:
    """
    Send a plain text message to a WhatsApp number.
    
    Args:
        to_phone: Recipient phone number with country code (e.g. "919876543210")
        text: Message text (max 4096 chars)
    """
    # Truncate if too long
    if len(text) > 4096:
        text = text[:4090] + "\n..."

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": text,
        },
    }
    return _send_request(payload)


# ════════════════════════════════════════════════════════════════
# INTERACTIVE MESSAGES (Buttons & Lists)
# ════════════════════════════════════════════════════════════════

def send_button_message(
    to_phone: str,
    body_text: str,
    buttons: list[dict],
    header: Optional[str] = None,
    footer: Optional[str] = None,
) -> dict:
    """
    Send an interactive message with quick-reply buttons.
    Max 3 buttons, each with id and title.
    
    Example buttons:
        [{"id": "membership", "title": "Membership Info"},
         {"id": "trial", "title": "Free Trial"},
         {"id": "pricing", "title": "Pricing"}]
    """
    button_rows = [
        {"type": "reply", "reply": {"id": b["id"], "title": b["title"][:20]}}
        for b in buttons[:3]
    ]

    interactive = {
        "type": "button",
        "body": {"text": body_text},
        "action": {"buttons": button_rows},
    }
    if header:
        interactive["header"] = {"type": "text", "text": header}
    if footer:
        interactive["footer"] = {"text": footer}

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "interactive",
        "interactive": interactive,
    }
    return _send_request(payload)


def send_list_message(
    to_phone: str,
    body_text: str,
    button_text: str,
    sections: list[dict],
    header: Optional[str] = None,
    footer: Optional[str] = None,
) -> dict:
    """
    Send an interactive list message with selectable options.
    
    Example sections:
        [{"title": "Services", "rows": [
            {"id": "gym_membership", "title": "Gym Membership", "description": "Monthly plans"},
            {"id": "personal_training", "title": "Personal Training", "description": "1-on-1 sessions"},
        ]}]
    """
    interactive = {
        "type": "list",
        "body": {"text": body_text},
        "action": {
            "button": button_text[:20],
            "sections": sections,
        },
    }
    if header:
        interactive["header"] = {"type": "text", "text": header}
    if footer:
        interactive["footer"] = {"text": footer}

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "interactive",
        "interactive": interactive,
    }
    return _send_request(payload)


# ════════════════════════════════════════════════════════════════
# TEMPLATE MESSAGES (for business-initiated conversations)
# ════════════════════════════════════════════════════════════════

def send_template_message(
    to_phone: str,
    template_name: str,
    language_code: str = "en",
    parameters: Optional[list[str]] = None,
) -> dict:
    """
    Send a pre-approved template message.
    Required for business-initiated conversations (e.g. follow-ups).
    
    Args:
        to_phone: Recipient phone number
        template_name: Name of the approved template
        language_code: Template language (default "en")
        parameters: List of parameter values to fill in the template
    """
    template = {
        "name": template_name,
        "language": {"code": language_code},
    }

    if parameters:
        template["components"] = [
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "text": p} for p in parameters
                ],
            }
        ]

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "template",
        "template": template,
    }
    return _send_request(payload)


# ════════════════════════════════════════════════════════════════
# IMAGE MESSAGES (for charts)
# ════════════════════════════════════════════════════════════════

def send_image_message(
    to_phone: str,
    image_url: str,
    caption: Optional[str] = None,
) -> dict:
    """
    Send an image message (e.g. chart screenshot, report).
    Image must be a publicly accessible URL.
    """
    image = {"link": image_url}
    if caption:
        image["caption"] = caption[:1024]

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "image",
        "image": image,
    }
    return _send_request(payload)


# ════════════════════════════════════════════════════════════════
# MARK AS READ
# ════════════════════════════════════════════════════════════════

def mark_as_read(message_id: str) -> dict:
    """Mark an incoming message as read (blue ticks)."""
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
    }
    return _send_request(payload)
