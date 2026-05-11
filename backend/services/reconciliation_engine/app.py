from __future__ import annotations

import asyncio

import orjson

from common.config import Settings
from common.kafka import create_consumer
from common.log import get_logger
from common.models import TransactionEvent
from common.redis import create_redis
from .store import TransactionStore


async def publish_graph(redis, snapshot, settings: Settings) -> None:
    payload = {"type": "graph", "payload": snapshot.model_dump()}
    data = orjson.dumps(payload).decode("utf-8")
    history_key = f"vf:history:{snapshot.transaction_id}"
    history_data = orjson.dumps(snapshot.model_dump()).decode("utf-8")
    await redis.publish("vf.graph", data)
    await redis.set(f"vf:graph:{snapshot.transaction_id}", data)
    await redis.rpush(history_key, history_data)
    await redis.ltrim(history_key, -settings.replay_buffer_size, -1)
    await redis.lpush("vf:recent", snapshot.transaction_id)
    await redis.ltrim("vf:recent", 0, settings.max_recent_transactions - 1)


async def publish_incident(redis, incident, settings: Settings) -> None:
    payload = {"type": "incident", "payload": incident.model_dump()}
    data = orjson.dumps(payload).decode("utf-8")
    await redis.publish("vf.incident", data)
    await redis.lpush("vf:incidents", data)
    await redis.ltrim("vf:incidents", 0, settings.max_recent_transactions * 5)


async def publish_metrics(redis, metrics) -> None:
    payload = {"type": "metrics", "payload": metrics.model_dump()}
    data = orjson.dumps(payload).decode("utf-8")
    await redis.publish("vf.metrics", data)
    await redis.set("vf:metrics", data)


async def run() -> None:
    settings = Settings()
    logger = get_logger(settings.service_name)
    redis = create_redis(settings)

    consumer = await create_consumer(
        settings,
        [settings.kafka_events_topic],
        group_id="reconciliation-engine",
    )
    store = TransactionStore(settings)

    async def event_loop() -> None:
        async for message in consumer:
            try:
                event = TransactionEvent(**message.value)
            except Exception:
                continue
            result = store.apply_event(event)
            await publish_graph(redis, result.snapshot, settings)
            for incident in result.incidents:
                await publish_incident(redis, incident, settings)
            await publish_metrics(redis, result.metrics)

    async def missing_loop() -> None:
        while True:
            results = store.check_missing()
            for result in results:
                await publish_graph(redis, result.snapshot, settings)
                for incident in result.incidents:
                    await publish_incident(redis, incident, settings)
                await publish_metrics(redis, result.metrics)
            await asyncio.sleep(1.0)

    try:
        await asyncio.gather(event_loop(), missing_loop())
    finally:
        await consumer.stop()
        await redis.close()
