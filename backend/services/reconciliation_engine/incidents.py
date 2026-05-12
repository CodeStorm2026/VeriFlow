from __future__ import annotations

from datetime import datetime
from typing import Iterable

from common.config import DEFAULT_TRUST_SCORES
from common.models import (
    Incident,
    IncidentSeverity,
    IncidentType,
    NodeStatus,
    TransactionEvent,
)
from common.utils import new_id, now_utc


def confidence_for(nodes: Iterable[str], trust_scores: dict[str, float]) -> float:
    if not nodes:
        return 0.5
    scores = [trust_scores.get(node, 0.5) for node in nodes]
    return round(min(scores), 2)


def build_incident(
    *,
    transaction_id: str,
    incident_type: IncidentType,
    message: str,
    affected_nodes: list[str],
    severity: IncidentSeverity,
    edge: str | None = None,
    metadata: dict | None = None,
    trust_scores: dict[str, float] | None = None,
) -> Incident:
    scores = trust_scores or DEFAULT_TRUST_SCORES
    confidence = confidence_for(affected_nodes, scores)
    return Incident(
        incident_id=new_id("inc"),
        transaction_id=transaction_id,
        type=incident_type,
        severity=severity,
        message=message,
        confidence=confidence,
        affected_nodes=affected_nodes,
        edge=edge,
        timestamp=now_utc(),
        metadata=metadata or {},
    )


def node_status_from_incident(incident: Incident) -> NodeStatus:
    if incident.type == IncidentType.DELAYED_EVENT:
        return NodeStatus.DELAYED
    if incident.type == IncidentType.DUPLICATE_EVENT:
        return NodeStatus.DUPLICATE
    if incident.type in {
        IncidentType.AMOUNT_MISMATCH,
        IncidentType.FEE_MISMATCH,
        IncidentType.FEE_POLICY_MISMATCH,
        IncidentType.FX_MISMATCH,
    }:
        return NodeStatus.MISMATCH
    if incident.type == IncidentType.BANK_LEDGER_AUTOCORRECT:
        return NodeStatus.HEALTHY
    if incident.type == IncidentType.MISSING_HOP:
        return NodeStatus.MISSING
    return NodeStatus.UNKNOWN
