from __future__ import annotations

import asyncio
import random

from common.config import Settings
from common.constants import CRYPTO_PATH, STANDARD_PATH
from common.kafka import create_producer
from common.log import get_logger
from common.models import EventType, TransactionEvent
from common.utils import jittered_interval, new_id, now_utc


async def run() -> None:
    settings = Settings()
    logger = get_logger(settings.service_name)
    producer = await create_producer(settings)
    sequence = 1000

    try:
        while True:
            sequence += 1
            transaction_id = f"tx-{sequence}"
            flow_type = "crypto" if random.random() < 0.2 else "standard"
            path = CRYPTO_PATH if flow_type == "crypto" else STANDARD_PATH
            amount = round(random.uniform(50, 200), 2)

            event = TransactionEvent(
                event_id=new_id("evt"),
                transaction_id=transaction_id,
                node_id="merchant",
                event_type=EventType.PAYMENT_INITIATED,
                amount=amount,
                currency="USD",
                fee=0.0,
                timestamp=now_utc(),
                metadata={
                    "path": path,
                    "flow_type": flow_type,
                },
            )

            await producer.send_and_wait(
                settings.kafka_events_topic,
                event,
                key=transaction_id,
            )
            logger.info("emitted %s flow=%s amount=%.2f", transaction_id, flow_type, amount)

            await asyncio.sleep(
                jittered_interval(settings.simulator_rate_per_sec, settings.simulator_jitter_ms)
            )
    finally:
        await producer.stop()
