from __future__ import annotations

import asyncio
import random

from common.config import Settings
from common.constants import (
    CRYPTO_PATH,
    PAYMENT_RAIL_CARD,
    PAYMENT_RAIL_CRYPTO,
    PAYMENT_RAIL_TRANSFER,
    STANDARD_PATH,
)
from common.heartbeat import run_heartbeat_loop
from common.kafka import create_producer
from common.log import get_logger
from common.models import ControlCommand, ControlType, EventType, TransactionEvent
from common.redis import create_redis
from common.utils import jittered_interval, new_id, now_utc


def _pick_synthetic_fault(is_crypto: bool) -> tuple[ControlType, str]:
    """Return (control type, target_node) for reconciliation demo traffic."""
    if is_crypto:
        choices: list[tuple[tuple[ControlType, str], float]] = [
            ((ControlType.FEE_MISMATCH, "gateway"), 0.2),
            ((ControlType.FEE_MISMATCH, "crypto_exchange"), 0.2),
            ((ControlType.FEE_MISMATCH, "bank"), 0.12),
            ((ControlType.DELAY, "gateway"), 0.12),
            ((ControlType.DELAY, "crypto_exchange"), 0.1),
            ((ControlType.DUPLICATE, "gateway"), 0.08),
            ((ControlType.DUPLICATE, "crypto_exchange"), 0.06),
            ((ControlType.MISSING, "crypto_exchange"), 0.07),
            ((ControlType.MISSING, "bank"), 0.05),
        ]
    else:
        choices = [
            ((ControlType.FEE_MISMATCH, "gateway"), 0.34),
            ((ControlType.FEE_MISMATCH, "bank"), 0.24),
            ((ControlType.DELAY, "gateway"), 0.18),
            ((ControlType.DUPLICATE, "gateway"), 0.1),
            ((ControlType.MISSING, "gateway"), 0.07),
            ((ControlType.MISSING, "bank"), 0.07),
        ]
    pairs, weights = zip(*choices, strict=True)
    return random.choices(pairs, weights=weights, k=1)[0]


async def _maybe_queue_synthetic_fault(
    producer,
    settings: Settings,
    transaction_id: str,
    prof: dict,
    logger,
) -> None:
    p = settings.simulator_fault_probability
    if p <= 0 or random.random() >= p:
        return
    is_crypto = prof["flow_type"] == "crypto"
    ctrl_type, target_node = _pick_synthetic_fault(is_crypto)
    delay_ms = None
    if ctrl_type == ControlType.DELAY:
        delay_ms = max(3500, settings.delay_threshold_ms + 1500)
    command = ControlCommand(
        command_id=new_id("cmd"),
        type=ctrl_type,
        target_node=target_node,
        count=1,
        delay_ms=delay_ms,
        transaction_id=transaction_id,
        created_at=now_utc(),
    )
    await producer.send_and_wait(
        settings.kafka_control_topic, command, key=transaction_id
    )
    logger.info(
        "synthetic fault queued tx=%s type=%s target=%s",
        transaction_id,
        ctrl_type,
        target_node,
    )
    grace = settings.simulator_inject_grace_ms / 1000.0
    if grace > 0:
        await asyncio.sleep(grace)


def _pick_rail_profile(settings: Settings) -> dict:
    weights = [
        settings.rail_weight_card,
        settings.rail_weight_transfer,
        settings.rail_weight_crypto * max(0.05, settings.crypto_flow_probability),
    ]
    idx = random.choices(range(3), weights=weights, k=1)[0]
    if idx == 0:
        return {
            "payment_rail": PAYMENT_RAIL_CARD,
            "flow_type": "standard",
            "path": STANDARD_PATH,
            "tx_kind": "card",
            "currency": "USD",
            "settlement_rail": "fiat_card_rtp",
            "scheme": "issuer_acquirer",
        }
    if idx == 1:
        return {
            "payment_rail": PAYMENT_RAIL_TRANSFER,
            "flow_type": "standard",
            "path": STANDARD_PATH,
            "tx_kind": "transfer",
            "currency": random.choice(["UZS", "USD", "EUR"]),
            "settlement_rail": "account_transfer",
            "scheme": random.choice(["instant_local", "ach_like", "cross_border"]),
        }
    return {
        "payment_rail": PAYMENT_RAIL_CRYPTO,
        "flow_type": "crypto",
        "path": CRYPTO_PATH,
        "tx_kind": random.choice(["card", "transfer"]),
        "currency": "USD",
        "settlement_rail": "crypto_bridge",
        "scheme": "stablecoin_bridge",
    }


async def run() -> None:
    settings = Settings()
    logger = get_logger(settings.service_name)
    redis = create_redis(settings)
    producer = await create_producer(settings)
    sequence = 1000

    async def emit_loop() -> None:
        nonlocal sequence
        while True:
            sequence += 1
            transaction_id = f"tx-{sequence}"
            prof = _pick_rail_profile(settings)
            amount = round(random.uniform(50, 200), 2)

            event = TransactionEvent(
                event_id=new_id("evt"),
                transaction_id=transaction_id,
                node_id="merchant",
                event_type=EventType.PAYMENT_INITIATED,
                amount=amount,
                currency=prof["currency"],
                fee=0.0,
                timestamp=now_utc(),
                metadata={
                    "path": prof["path"],
                    "flow_type": prof["flow_type"],
                    "payment_rail": prof["payment_rail"],
                    "tx_kind": prof["tx_kind"],
                    "fee_model": "none",
                    "fee_basis": "merchant_gross",
                    "settlement_rail": prof["settlement_rail"],
                    "transfer_scheme": prof["scheme"],
                },
            )

            await _maybe_queue_synthetic_fault(
                producer, settings, transaction_id, prof, logger
            )

            await producer.send_and_wait(
                settings.kafka_events_topic,
                event,
                key=transaction_id,
            )
            logger.info(
                "emitted %s rail=%s flow=%s amount=%.2f %s",
                transaction_id,
                prof["payment_rail"],
                prof["flow_type"],
                amount,
                prof["currency"],
            )

            await asyncio.sleep(
                jittered_interval(settings.simulator_rate_per_sec, settings.simulator_jitter_ms)
            )

    try:
        await asyncio.gather(
            emit_loop(),
            run_heartbeat_loop(redis, settings.node_id, settings.heartbeat_interval_sec),
        )
    finally:
        await producer.stop()
        await redis.close()
