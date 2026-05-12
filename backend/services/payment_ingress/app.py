from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from common.config import Settings as VFSettings
from common.kafka import create_producer
from common.log import get_logger
from common.models import EventType, TransactionEvent
from common.utils import new_id, now_utc

from .adapters.stripe_like import try_parse_stripe_webhook


class CanonicalGatewayEvent(BaseModel):
    """Normalized event from your PSP integration layer or a reverse-proxy."""

    transaction_id: str
    node_id: str
    event_type: EventType
    amount: float
    currency: str
    fee: float = 0.0
    occurred_at: datetime | None = None
    payment_rail: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def _check_bearer(settings: VFSettings, authorization: str | None) -> None:
    token = (settings.ingest_bearer_token or "").strip()
    if not token:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")
    got = authorization.removeprefix("Bearer ").strip()
    if got != token:
        raise HTTPException(status_code=401, detail="Invalid bearer token")


@asynccontextmanager
async def lifespan(app: FastAPI):
    vf_settings = VFSettings()
    logger = get_logger(vf_settings.service_name)
    producer = await create_producer(vf_settings)
    app.state.settings = vf_settings
    app.state.producer = producer
    app.state.logger = logger
    try:
        yield
    finally:
        await producer.stop()


app = FastAPI(
    title="VeriFlow Payment Ingress",
    version="0.1.0",
    description="Accept webhooks / server callbacks from real PSPs and publish to Kafka vf.events",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "payment-ingress"}


@app.post("/api/ingest/v1/event")
async def ingest_canonical(
    body: CanonicalGatewayEvent,
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    """Publish one canonical event (your middleware maps Payme/Click/etc. into this shape)."""
    settings: VFSettings = request.app.state.settings
    _check_bearer(settings, authorization)
    producer = request.app.state.producer
    ts = body.occurred_at or now_utc()
    meta = {**body.metadata, "ingest_adapter": "canonical"}
    if body.payment_rail:
        meta["payment_rail"] = body.payment_rail
    event = TransactionEvent(
        event_id=new_id("evt"),
        transaction_id=body.transaction_id,
        node_id=body.node_id,
        event_type=body.event_type,
        amount=body.amount,
        currency=body.currency,
        fee=body.fee,
        timestamp=ts,
        metadata=meta,
    )
    await producer.send_and_wait(settings.kafka_events_topic, event, key=body.transaction_id)
    request.app.state.logger.info(
        "ingested canonical tx=%s node=%s type=%s",
        body.transaction_id,
        body.node_id,
        body.event_type,
    )
    return {"status": "accepted", "event_id": event.event_id}


@app.post("/api/ingest/v1/stripe/webhook")
async def ingest_stripe_like(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    """
    Accept a Stripe-shaped JSON body (e.g. payment_intent.succeeded).
    For production Stripe: verify signature header and use their SDK.
    """
    settings: VFSettings = request.app.state.settings
    _check_bearer(settings, authorization)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    event = try_parse_stripe_webhook(body, default_node_id=settings.ingest_default_node_id)
    if event is None:
        return {"status": "ignored", "reason": "unsupported_or_unknown_event_type"}
    producer = request.app.state.producer
    await producer.send_and_wait(settings.kafka_events_topic, event, key=event.transaction_id)
    request.app.state.logger.info("ingested stripe_like tx=%s", event.transaction_id)
    return {"status": "accepted", "event_id": event.event_id}


async def run() -> None:
    settings = VFSettings()
    import uvicorn

    config = uvicorn.Config(
        "services.payment_ingress.app:app",
        host=settings.ingest_host,
        port=settings.ingest_port,
        log_level="info",
        reload=False,
    )
    server = uvicorn.Server(config)
    await server.serve()
