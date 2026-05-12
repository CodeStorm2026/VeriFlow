from __future__ import annotations

import asyncio
from datetime import timedelta

from common.config import Settings
from common.fee_settings import load_fee_settings
from common.heartbeat import run_heartbeat_loop
from common.redis import create_redis
from common.injection import InjectionController
from common.kafka import create_consumer, create_producer
from common.log import get_logger
from common.models import ControlCommand, ControlType, EventType, TransactionEvent
from common.utils import new_id, now_utc


async def _control_loop(
    consumer, controller: InjectionController, settings: Settings, logger
) -> None:
    async for message in consumer:
        try:
            command = ControlCommand(**message.value)
        except Exception:
            continue
        if command.target_node and command.target_node != settings.node_id:
            continue
        controller.add(command)
        logger.info("control received type=%s", command.type)


async def _event_loop(
    producer, consumer, controller: InjectionController, settings: Settings, redis, logger
) -> None:
    async for message in consumer:
        try:
            upstream = TransactionEvent(**message.value)
        except Exception:
            continue
        if upstream.node_id != "merchant":
            continue

        plan = controller.consume(settings.node_id, upstream.transaction_id)
        if plan and plan.type == ControlType.MISSING:
            logger.info("missing injected for %s", upstream.transaction_id)
            continue
        delay_ms = 0
        if plan and plan.type == ControlType.DELAY and plan.delay_ms:
            delay_ms = plan.delay_ms
            await asyncio.sleep(delay_ms / 1000)

        fee_cfg = await load_fee_settings(redis, settings)
        fee_model = str(fee_cfg["gateway_fee_model"]).lower()
        if fee_model == "fixed":
            fee = round(float(fee_cfg["gateway_fixed_fee"]), 2)
        else:
            fee = round(upstream.amount * float(fee_cfg["gateway_fee_rate"]), 2)
        # Sender (merchant) pays fee: principal to next hop equals merchant amount.
        amount = round(upstream.amount, 2)
        if plan and plan.type == ControlType.FEE_MISMATCH:
            fee = round(fee + 1.5, 2)

        metadata = dict(upstream.metadata)
        metadata.update({
            "source_event_id": upstream.event_id,
            "fee_model": fee_model,
            "fee_rate": float(fee_cfg["gateway_fee_rate"]),
            "fixed_fee": float(fee_cfg["gateway_fixed_fee"]),
            "fee_basis": "sender_merchant",
            "fee_payer": fee_cfg["fee_payer"],
            "policy_max_bank_fee_vs_gateway": float(fee_cfg["policy_max_bank_fee_vs_gateway"]),
        })

        event_timestamp = now_utc() - timedelta(milliseconds=delay_ms)
        event = TransactionEvent(
            event_id=new_id("evt"),
            transaction_id=upstream.transaction_id,
            node_id="gateway",
            event_type=EventType.PAYMENT_PROCESSED,
            amount=amount,
            currency=upstream.currency,
            fee=fee,
            timestamp=event_timestamp,
            metadata=metadata,
        )

        await producer.send_and_wait(settings.kafka_events_topic, event, key=event.transaction_id)
        logger.info("processed %s amount=%.2f fee=%.2f", event.transaction_id, amount, fee)

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
    redis = create_redis(settings)

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
            _event_loop(producer, event_consumer, controller, settings, redis, logger),
            _control_loop(control_consumer, controller, settings, logger),
            run_heartbeat_loop(redis, settings.node_id, settings.heartbeat_interval_sec),
        )
    finally:
        await event_consumer.stop()
        await control_consumer.stop()
        await producer.stop()
        await redis.close()
