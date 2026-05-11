from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import orjson
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from common.config import Settings
from common.kafka import create_producer
from common.log import get_logger
from common.models import ControlCommand, ControlType
from common.redis import create_redis
from common.utils import new_id, now_utc

from .connections import ConnectionManager


class ControlRequest(BaseModel):
    type: ControlType
    target_node: str | None = None
    count: int = 1
    delay_ms: int | None = None
    transaction_id: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    logger = get_logger(settings.service_name)
    redis = create_redis(settings)
    producer = await create_producer(settings)
    manager = ConnectionManager()

    app.state.settings = settings
    app.state.logger = logger
    app.state.redis = redis
    app.state.producer = producer
    app.state.manager = manager

    listener_task = asyncio.create_task(_redis_listener(app))
    app.state.listener_task = listener_task

    try:
        yield
    finally:
        listener_task.cancel()
        await producer.stop()
        await redis.close()


app = FastAPI(title="VeriFlow WebSocket API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _redis_listener(app: FastAPI) -> None:
    redis = app.state.redis
    manager: ConnectionManager = app.state.manager
    pubsub = redis.pubsub()
    await pubsub.subscribe("vf.graph", "vf.incident", "vf.metrics")
    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            data = message.get("data")
            if not data:
                continue
            await manager.broadcast_raw(data)
    finally:
        await pubsub.close()


async def _bootstrap(redis, settings: Settings) -> dict:
    recent_ids = await redis.lrange("vf:recent", 0, settings.max_recent_transactions - 1)
    graphs: list[dict] = []
    for tx_id in recent_ids:
        raw = await redis.get(f"vf:graph:{tx_id}")
        if raw:
            graphs.append(orjson.loads(raw.encode("utf-8")).get("payload", {}))

    incident_raw = await redis.lrange("vf:incidents", 0, settings.max_recent_transactions * 3)
    incidents = [orjson.loads(item.encode("utf-8")).get("payload", {}) for item in incident_raw]

    metrics_raw = await redis.get("vf:metrics")
    metrics = (
        orjson.loads(metrics_raw.encode("utf-8")).get("payload", {})
        if metrics_raw
        else {}
    )

    return {
        "graphs": graphs,
        "incidents": incidents,
        "metrics": metrics,
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/demo/inject")
async def inject_fault(request: ControlRequest) -> dict:
    settings: Settings = app.state.settings
    command = ControlCommand(
        command_id=new_id("cmd"),
        type=request.type,
        target_node=request.target_node,
        count=request.count,
        delay_ms=request.delay_ms,
        transaction_id=request.transaction_id,
        created_at=now_utc(),
    )
    await app.state.producer.send_and_wait(settings.kafka_control_topic, command)
    return {"status": "queued", "command_id": command.command_id}


@app.get("/tx/{tx_id}/history")
async def tx_history(tx_id: str) -> dict:
    settings: Settings = app.state.settings
    redis = app.state.redis
    raw_items = await redis.lrange(f"vf:history:{tx_id}", 0, -1)
    history: list[dict] = []
    for item in raw_items:
        try:
            history.append(orjson.loads(item.encode("utf-8")))
        except Exception:
            continue
    return {"transaction_id": tx_id, "history": history}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    settings: Settings = app.state.settings
    manager: ConnectionManager = app.state.manager
    await manager.connect(websocket)

    try:
        bootstrap = await _bootstrap(app.state.redis, settings)
        await websocket.send_json({"type": "bootstrap", "payload": bootstrap})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def run() -> None:
    settings = Settings()
    import uvicorn

    config = uvicorn.Config(
        "services.websocket_api.app:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
        reload=False,
    )
    server = uvicorn.Server(config)
    await server.serve()
