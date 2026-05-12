from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict

from .models import TransactionEvent, NodeStatus


@dataclass
class NodeObservation:
    event: TransactionEvent
    received_at: datetime
    status: NodeStatus
    duplicates: int = 0


@dataclass
class EdgeObservation:
    status: str
    last_event_id: str | None = None


@dataclass
class TransactionState:
    transaction_id: str
    flow_type: str
    flow_path: list[str]
    payment_rail: str
    nodes: Dict[str, NodeObservation]
    seen_event_ids: set[str]
    last_updated: datetime
    missing_reported: set[str]
    # Display / recon: assume bank posting error; nudge bank leg toward upstream settlement (demo).
    virtual_node_adjustments: Dict[str, float] = field(default_factory=dict)
