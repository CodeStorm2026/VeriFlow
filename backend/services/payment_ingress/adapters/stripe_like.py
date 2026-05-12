from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from common.models import EventType, TransactionEvent
from common.utils import new_id, now_utc


def try_parse_stripe_webhook(
    body: dict[str, Any],
    *,
    default_node_id: str,
) -> TransactionEvent | None:
    """
    Minimal Stripe-style `payment_intent.succeeded` mapping for demos.
    Production: verify `Stripe-Signature`, use official SDK, handle idempotency.
    """
    if body.get("type") != "payment_intent.succeeded":
        return None
    data = body.get("data") or {}
    obj = data.get("object") or {}
    if not isinstance(obj, dict):
        return None
    meta = obj.get("metadata") or {}
    tx_id = meta.get("transaction_id") or meta.get("tx_id") or meta.get("order_id")
    if not tx_id:
        tx_id = str(obj.get("id") or "unknown")
    amount_minor = obj.get("amount_received") or obj.get("amount") or 0
    try:
        amount = float(amount_minor) / 100.0
    except (TypeError, ValueError):
        amount = 0.0
    currency = str(obj.get("currency") or "usd").upper()
    fee_minor = obj.get("application_fee_amount") or 0
    try:
        fee = float(fee_minor) / 100.0
    except (TypeError, ValueError):
        fee = 0.0
    created = obj.get("created")
    if isinstance(created, (int, float)):
        ts = datetime.fromtimestamp(float(created), tz=timezone.utc)
    else:
        ts = now_utc()
    return TransactionEvent(
        event_id=new_id("evt"),
        transaction_id=str(tx_id),
        node_id=default_node_id,
        event_type=EventType.PAYMENT_PROCESSED,
        amount=round(amount, 2),
        currency=currency,
        fee=round(fee, 2),
        timestamp=ts,
        metadata={
            "ingest_adapter": "stripe_like",
            "stripe_payment_intent_id": obj.get("id"),
            "raw_type": body.get("type"),
        },
    )
