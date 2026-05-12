from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timedelta

from common.models import MetricsSnapshot
from common.utils import now_utc


class MetricsTracker:
    def __init__(self, window_seconds: int = 10) -> None:
        self._window = timedelta(seconds=window_seconds)
        self._samples: deque[tuple[datetime, str, bool]] = deque()
        self._total_events = 0
        self._mismatch_events = 0
        self._last_latency_ms = 0.0

    def record_event(
        self,
        received_at: datetime,
        event_timestamp: datetime,
        mismatch: bool,
        *,
        node_id: str,
    ) -> None:
        self._total_events += 1
        if mismatch:
            self._mismatch_events += 1
        self._samples.append((received_at, node_id, mismatch))
        self._trim(received_at)
        self._last_latency_ms = max(0.0, (received_at - event_timestamp).total_seconds() * 1000)

    def snapshot(self, active_incidents: int) -> MetricsSnapshot:
        now = now_utc()
        self._trim(now)
        window_seconds = max(1.0, self._window.total_seconds())
        tx_per_sec = len(self._samples) / window_seconds
        mismatch_rate = 0.0
        if self._total_events:
            mismatch_rate = self._mismatch_events / self._total_events

        node_counts: Counter[str] = Counter()
        mismatch_in_window = 0
        for _ts, nid, mm in self._samples:
            node_counts[nid] += 1
            if mm:
                mismatch_in_window += 1

        return MetricsSnapshot(
            tx_per_sec=round(tx_per_sec, 2),
            mismatch_rate=round(mismatch_rate, 4),
            reconciliation_latency_ms=round(self._last_latency_ms, 2),
            active_incidents=active_incidents,
            updated_at=now,
            events_in_window=len(self._samples),
            mismatch_events_in_window=mismatch_in_window,
            node_events=dict(node_counts),
        )

    def _trim(self, now: datetime) -> None:
        threshold = now - self._window
        while self._samples and self._samples[0][0] < threshold:
            self._samples.popleft()
