from __future__ import annotations

from typing import Any, Iterable

import orjson
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from .config import Settings


def _serialize(value: Any) -> bytes:
    if hasattr(value, "model_dump"):
        return orjson.dumps(value.model_dump())
    return orjson.dumps(value)


def _deserialize(value: bytes) -> Any:
    return orjson.loads(value)


def _key_serializer(key: Any) -> bytes | None:
    if key is None:
        return None
    if isinstance(key, bytes):
        return key
    return str(key).encode("utf-8")


async def create_producer(settings: Settings) -> AIOKafkaProducer:
    producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap,
        value_serializer=_serialize,
        key_serializer=_key_serializer,
        acks="all",
    )
    await producer.start()
    return producer


async def create_consumer(
    settings: Settings,
    topics: Iterable[str],
    group_id: str,
) -> AIOKafkaConsumer:
    consumer = AIOKafkaConsumer(
        *topics,
        bootstrap_servers=settings.kafka_bootstrap,
        group_id=group_id,
        value_deserializer=_deserialize,
        enable_auto_commit=True,
        auto_offset_reset="latest",
    )
    await consumer.start()
    return consumer
