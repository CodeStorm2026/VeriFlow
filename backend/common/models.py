from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class EventType(StrEnum):
    PAYMENT_INITIATED = "PAYMENT_INITIATED"
    PAYMENT_PROCESSED = "PAYMENT_PROCESSED"
    FX_EXECUTED = "FX_EXECUTED"
    SETTLED = "SETTLED"


class NodeStatus(StrEnum):
    HEALTHY = "healthy"
    DELAYED = "delayed"
    MISMATCH = "mismatch"
    MISSING = "missing"
    DUPLICATE = "duplicate"
    UNKNOWN = "unknown"


class EdgeStatus(StrEnum):
    HEALTHY = "healthy"
    DELAYED = "delayed"
    MISMATCH = "mismatch"
    MISSING = "missing"


class IncidentSeverity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentType(StrEnum):
    AMOUNT_MISMATCH = "amount_mismatch"
    FEE_MISMATCH = "fee_mismatch"
    FX_MISMATCH = "fx_mismatch"
    DUPLICATE_EVENT = "duplicate_event"
    MISSING_HOP = "missing_hop"
    DELAYED_EVENT = "delayed_event"


class ControlType(StrEnum):
    FEE_MISMATCH = "fee_mismatch"
    DELAY = "delay"
    DUPLICATE = "duplicate"
    MISSING = "missing"


class TransactionEvent(BaseModel):
    event_id: str
    transaction_id: str
    node_id: str
    event_type: EventType
    amount: float
    currency: str
    fee: float = 0.0
    timestamp: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class ControlCommand(BaseModel):
    command_id: str
    type: ControlType
    target_node: str | None = None
    count: int = 1
    delay_ms: int | None = None
    transaction_id: str | None = None
    created_at: datetime


class GraphNode(BaseModel):
    id: str
    label: str
    status: NodeStatus
    amount: float | None = None
    fee: float | None = None
    currency: str | None = None
    timestamp: datetime | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    status: EdgeStatus
    animated: bool = False
    last_event_id: str | None = None


class GraphSnapshot(BaseModel):
    transaction_id: str
    flow_type: str
    path: list[str]
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    updated_at: datetime


class Incident(BaseModel):
    incident_id: str
    transaction_id: str
    type: IncidentType
    severity: IncidentSeverity
    message: str
    confidence: float
    affected_nodes: list[str]
    edge: str | None = None
    timestamp: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class MetricsSnapshot(BaseModel):
    tx_per_sec: float
    mismatch_rate: float
    reconciliation_latency_ms: float
    active_incidents: int
    updated_at: datetime


class WsMessage(BaseModel):
    type: Literal["graph", "incident", "metrics", "bootstrap", "log"]
    payload: dict[str, Any]
