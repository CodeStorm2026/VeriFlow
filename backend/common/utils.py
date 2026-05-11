from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def jittered_interval(rate_per_sec: float, jitter_ms: int) -> float:
    if rate_per_sec <= 0:
        return 1.0
    base = 1.0 / rate_per_sec
    jitter = random.uniform(-jitter_ms, jitter_ms) / 1000.0
    return max(0.05, base + jitter)


def approx_equal(left: float, right: float, tolerance: float = 0.01) -> bool:
    return abs(left - right) <= tolerance
