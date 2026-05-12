from __future__ import annotations

import asyncio

from common.utils import now_utc


async def run_heartbeat_loop(redis, node_id: str, interval_sec: float) -> None:
    while True:
        try:
            ms = int(now_utc().timestamp() * 1000)
            await redis.hset("vf:source_heartbeats", node_id, str(ms))
        except Exception:
            pass
        await asyncio.sleep(max(1.0, interval_sec))
