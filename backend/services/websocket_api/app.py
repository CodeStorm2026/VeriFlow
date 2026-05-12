from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

import orjson
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from common.config import Settings
from common.escalation import (
    ESCALATION_ZSET,
    SLA_HASH_PREFIX,
    clear_escalation,
    fetch_pending_escalations,
)
from common.fee_settings import (
    FEE_SETTINGS_REDIS_KEY,
    FeeSettingsPatch,
    FeeSettingsPublic,
    load_fee_settings,
    parse_stored_fee_overrides,
)
from common.kafka import create_producer
from common.log import get_logger
from common.manual_demo import (
    DemoScenarioRequest,
    build_control_commands_for_scenario,
    build_merchant_init_event,
    normalize_demo_transaction_id,
    validate_scenario_for_rail,
)
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


class ImmediateEscalationRequest(BaseModel):
    incident_id: str
    transaction_id: str = ""


class CorrectionRequest(BaseModel):
    transaction_id: str
    node_id: str
    delta_amount: float = 0.0
    proposed_amount: float | None = None
    proposed_fee: float | None = None


EXPECTED_SOURCES = ("merchant", "gateway", "bank", "crypto_exchange")


async def _build_source_health(redis, settings: Settings) -> dict:
    now_ms = int(time.time() * 1000)
    beats = await redis.hgetall("vf:source_heartbeats")
    nodes: dict[str, dict] = {}
    for node in EXPECTED_SOURCES:
        raw = beats.get(node)
        if not raw:
            nodes[node] = {"status": "unknown", "last_seen_ms": None, "age_ms": None}
            continue
        last = int(raw)
        age = now_ms - last
        stale = age > settings.source_stale_after_ms
        nodes[node] = {
            "status": "stale" if stale else "ok",
            "last_seen_ms": last,
            "age_ms": age,
        }
    return {"nodes": nodes, "checked_at_ms": now_ms}


async def _escalation_sweeper(app: FastAPI) -> None:
    redis = app.state.redis
    manager: ConnectionManager = app.state.manager
    while True:
        await asyncio.sleep(2.0)
        try:
            now_ms = int(time.time() * 1000)
            due = await redis.zrangebyscore(ESCALATION_ZSET, "-inf", now_ms)
            for iid in due:
                raw = await redis.hgetall(f"{SLA_HASH_PREFIX}{iid}")
                await redis.zrem(ESCALATION_ZSET, iid)
                await redis.delete(f"{SLA_HASH_PREFIX}{iid}")
                await manager.broadcast_json(
                    {
                        "type": "escalation_due",
                        "payload": {
                            "incident_id": iid,
                            "transaction_id": raw.get("transaction_id", ""),
                            "source": "sla_timer",
                            "fired_at_ms": now_ms,
                        },
                    }
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            continue


async def _source_health_loop(app: FastAPI) -> None:
    redis = app.state.redis
    manager: ConnectionManager = app.state.manager
    settings: Settings = app.state.settings
    while True:
        await asyncio.sleep(8.0)
        try:
            payload = await _build_source_health(redis, settings)
            await manager.broadcast_json({"type": "source_health", "payload": payload})
        except asyncio.CancelledError:
            raise
        except Exception:
            continue


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
    sweeper_task = asyncio.create_task(_escalation_sweeper(app))
    health_task = asyncio.create_task(_source_health_loop(app))
    app.state.listener_task = listener_task
    app.state.sweeper_task = sweeper_task
    app.state.health_task = health_task

    try:
        yield
    finally:
        for task in (listener_task, sweeper_task, health_task):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
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
    await pubsub.subscribe("vf.graph", "vf.incident", "vf.metrics", "vf.escalation")
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

    escalations = await fetch_pending_escalations(redis)
    source_health = await _build_source_health(redis, settings)

    return {
        "graphs": graphs,
        "incidents": incidents,
        "metrics": metrics,
        "escalations": escalations,
        "source_health": source_health,
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/health/sources")
async def health_sources() -> dict:
    settings: Settings = app.state.settings
    return await _build_source_health(app.state.redis, settings)


_PATCHABLE_FEE_KEYS = frozenset(FeeSettingsPatch.model_fields.keys())


@app.get("/settings/fees")
async def get_fee_settings() -> dict:
    settings: Settings = app.state.settings
    merged = await load_fee_settings(app.state.redis, settings)
    return FeeSettingsPublic.model_validate(merged).model_dump()


@app.put("/settings/fees")
async def put_fee_settings(body: FeeSettingsPatch) -> dict:
    redis = app.state.redis
    settings: Settings = app.state.settings
    raw = await redis.get(FEE_SETTINGS_REDIS_KEY)
    current = parse_stored_fee_overrides(raw)
    for key, value in body.model_dump(exclude_none=True).items():
        if key in _PATCHABLE_FEE_KEYS:
            current[key] = value
    if current:
        await redis.set(FEE_SETTINGS_REDIS_KEY, orjson.dumps(current).decode("utf-8"))
    else:
        await redis.delete(FEE_SETTINGS_REDIS_KEY)
    merged = await load_fee_settings(redis, settings)
    return FeeSettingsPublic.model_validate(merged).model_dump()


@app.delete("/settings/fees")
async def delete_fee_settings_overrides() -> dict:
    await app.state.redis.delete(FEE_SETTINGS_REDIS_KEY)
    settings: Settings = app.state.settings
    merged = await load_fee_settings(app.state.redis, settings)
    return FeeSettingsPublic.model_validate(merged).model_dump()


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


@app.post("/demo/scenario")
async def demo_scenario(body: DemoScenarioRequest) -> dict:
    """Queue control hook(s) for a specific tx, then emit merchant PAYMENT_INITIATED (deterministic demo)."""
    settings: Settings = app.state.settings
    producer = app.state.producer
    conflict = validate_scenario_for_rail(body.scenario, body.payment_rail)
    if conflict:
        raise HTTPException(status_code=400, detail=conflict)
    tx_id = normalize_demo_transaction_id(body.transaction_id)
    commands = build_control_commands_for_scenario(body.scenario, tx_id, body.delay_ms)
    for command in commands:
        await producer.send_and_wait(settings.kafka_control_topic, command)
    init_event = build_merchant_init_event(body, tx_id)
    await producer.send_and_wait(settings.kafka_events_topic, init_event, key=tx_id)
    return {
        "status": "queued",
        "transaction_id": tx_id,
        "scenario": body.scenario.value,
        "payment_rail": body.payment_rail,
        "control_commands": len(commands),
        "note": "Commands are keyed to this transaction_id; simulators only enqueue matching targets.",
    }


@app.post("/escalations/immediate")
async def escalation_immediate(request: ImmediateEscalationRequest) -> dict:
    redis = app.state.redis
    manager: ConnectionManager = app.state.manager
    await clear_escalation(redis, request.incident_id)
    await manager.broadcast_json(
        {
            "type": "escalation_due",
            "payload": {
                "incident_id": request.incident_id,
                "transaction_id": request.transaction_id,
                "source": "manual",
                "fired_at_ms": int(time.time() * 1000),
            },
        }
    )
    return {"status": "escalated", "incident_id": request.incident_id}


@app.post("/mock/corrections")
async def mock_corrections(request: CorrectionRequest) -> dict:
    settings: Settings = app.state.settings
    manager: ConnectionManager = app.state.manager
    redis = app.state.redis

    delta = abs(request.delta_amount)
    auto_eligible = delta <= settings.autocorrect_max_delta and delta >= 0

    entry = {
        "transaction_id": request.transaction_id,
        "node_id": request.node_id,
        "delta_amount": request.delta_amount,
        "proposed_amount": request.proposed_amount,
        "proposed_fee": request.proposed_fee,
        "auto_eligible": auto_eligible,
        "autocorrect_max_delta": settings.autocorrect_max_delta,
        "recorded_at_ms": int(time.time() * 1000),
    }
    line = orjson.dumps(entry).decode("utf-8")
    await redis.lpush("vf:corrections_log", line)
    await redis.ltrim("vf:corrections_log", 0, 199)

    await manager.broadcast_json({"type": "correction", "payload": entry})

    return {
        "accepted": True,
        "auto_eligible": auto_eligible,
        "autocorrect_max_delta": settings.autocorrect_max_delta,
        "note": "Dataset-backed autocorrect is out of scope; threshold is configurable.",
    }


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
