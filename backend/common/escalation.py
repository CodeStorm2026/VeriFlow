from __future__ import annotations

import time

import orjson

from common.models import Incident, IncidentSeverity
from common.utils import now_utc

SLA_HASH_PREFIX = "vf:sla:"
ESCALATION_ZSET = "vf:escalation_due"


async def schedule_escalation_if_needed(
    redis, incident: Incident, *, sla_seconds: int
) -> None:
    if incident.severity not in (IncidentSeverity.HIGH, IncidentSeverity.CRITICAL):
        return
    deadline_ms = int((now_utc().timestamp() + sla_seconds) * 1000)
    iid = incident.incident_id
    mapping = {
        "transaction_id": incident.transaction_id,
        "incident_id": iid,
        "deadline_ms": str(deadline_ms),
        "severity": incident.severity.value,
        "incident_type": incident.type.value,
    }
    pipe = redis.pipeline(transaction=True)
    pipe.hset(f"{SLA_HASH_PREFIX}{iid}", mapping=mapping)
    pipe.zadd(ESCALATION_ZSET, {iid: deadline_ms})
    await pipe.execute()
    payload = {
        "type": "escalation_pending",
        "payload": {
            "incident_id": iid,
            "transaction_id": incident.transaction_id,
            "deadline_ms": deadline_ms,
            "sla_seconds": sla_seconds,
            "severity": incident.severity.value,
        },
    }
    await redis.publish("vf.escalation", orjson.dumps(payload).decode("utf-8"))


async def clear_escalation(redis, incident_id: str) -> None:
    await redis.zrem(ESCALATION_ZSET, incident_id)
    await redis.delete(f"{SLA_HASH_PREFIX}{incident_id}")


async def fetch_pending_escalations(redis) -> list[dict]:
    now_ms = int(time.time() * 1000)
    pairs = await redis.zrange(ESCALATION_ZSET, 0, -1, withscores=True)
    out: list[dict] = []
    for member, score in pairs:
        if score <= now_ms:
            continue
        data = await redis.hgetall(f"{SLA_HASH_PREFIX}{member}")
        if not data:
            continue
        out.append(
            {
                "incident_id": data.get("incident_id", member),
                "transaction_id": data.get("transaction_id", ""),
                "deadline_ms": int(data.get("deadline_ms", score)),
                "severity": data.get("severity", "high"),
            }
        )
    return out
