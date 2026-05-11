from __future__ import annotations

import asyncio
from datetime import timedelta

from common.config import Settings
from common.injection import InjectionController
from common.kafka import create_consumer, create_producer
from common.log import get_logger
from common.models import ControlCommand, ControlType, EventType, TransactionEvent
from common.utils import new_id, now_utc


async def _control_loop(consumer, controller: InjectionController, logger) -> None:
    async for message in consumer:
        try:
            command = ControlCommand(**message.value)
        except Exception:
            continue
        controller.add(command)
        logger.info("control received type=%s", command.type)


async def _event_loop(producer, consumer, controller: InjectionController, settings: Settings, logger) -> None:
    async for message in consumer:
        try:
            upstream = TransactionEvent(**message.value)
        except Exception:
            continue

        path = upstream.metadata.get("path", [])
        is_crypto = "crypto_exchange" in path
        if upstream.node_id == "gateway" and is_crypto:
            continue
        if upstream.node_id not in {"gateway", "crypto_exchange"}:
            continue

        plan = controller.consume(settings.node_id, upstream.transaction_id)
        if plan and plan.type == ControlType.MISSING:
            logger.info("missing injected for %s", upstream.transaction_id)
            continue
        delay_ms = 0
        if plan and plan.type == ControlType.DELAY and plan.delay_ms:
            delay_ms = plan.delay_ms
            await asyncio.sleep(delay_ms / 1000)

        if upstream.node_id == "crypto_exchange":
            base_amount = upstream.metadata.get("converted_amount", upstream.amount)
            currency = upstream.metadata.get("settlement_currency", "USD")
        else:
            base_amount = upstream.amount
            currency = upstream.currency

        fee = round(max(0.3, base_amount * 0.005), 2)
        amount = round(base_amount - fee, 2)

        if plan and plan.type == ControlType.FEE_MISMATCH:
            fee = round(fee + 0.8, 2)
            amount = round(base_amount - fee, 2)

        metadata = dict(upstream.metadata)
        metadata.update({
            "source_event_id": upstream.event_id,
            "upstream_node": upstream.node_id,
        })

        event_timestamp = now_utc() - timedelta(milliseconds=delay_ms)
        event = TransactionEvent(
            event_id=new_id("evt"),
            transaction_id=upstream.transaction_id,
            node_id="bank",
            event_type=EventType.SETTLED,
            amount=amount,
            currency=currency,
            fee=fee,
            timestamp=event_timestamp,
            metadata=metadata,
        )

        await producer.send_and_wait(settings.kafka_events_topic, event, key=event.transaction_id)
        logger.info("settled %s amount=%.2f fee=%.2f", event.transaction_id, amount, fee)

        if plan and plan.type == ControlType.DUPLICATE:
            await producer.send_and_wait(
                settings.kafka_events_topic,
                event,
                key=event.transaction_id,
            )
            logger.info("duplicate emitted for %s", event.transaction_id)


async def run() -> None:
    settings = Settings()
    logger = get_logger(settings.service_name)
    controller = InjectionController()

    producer = await create_producer(settings)
    event_consumer = await create_consumer(
        settings,
        [settings.kafka_events_topic],
        group_id=f"{settings.node_id}-events",
    )
    control_consumer = await create_consumer(
        settings,
        [settings.kafka_control_topic],
        group_id=f"{settings.node_id}-control",
    )

    try:
        await asyncio.gather(
            _event_loop(producer, event_consumer, controller, settings, logger),
            _control_loop(control_consumer, controller, logger),
        )
    finally:
        await event_consumer.stop()
        await control_consumer.stop()
        await producer.stop()
