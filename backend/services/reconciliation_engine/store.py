from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from common.config import DEFAULT_TRUST_SCORES, Settings
from common.constants import CRYPTO_PATH, STANDARD_PATH
from common.models import (
    EdgeStatus,
    Incident,
    IncidentSeverity,
    IncidentType,
    NodeStatus,
    TransactionEvent,
)
from common.types import NodeObservation, TransactionState
from common.utils import approx_equal, now_utc

from .graph import build_snapshot
from .incidents import build_incident, node_status_from_incident
from .metrics import MetricsTracker


@dataclass
class StoreResult:
    snapshot: "GraphSnapshot"
    incidents: list[Incident]
    metrics: "MetricsSnapshot"


class TransactionStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._states: dict[str, TransactionState] = {}
        self._metrics = MetricsTracker()
        self._trust_scores = DEFAULT_TRUST_SCORES
        self._active_incidents: dict[str, Incident] = {}

    def apply_event(self, event: TransactionEvent) -> StoreResult:
        received_at = now_utc()
        self._prune_incidents(received_at)
        state = self._states.get(event.transaction_id)
        if not state:
            flow_type = event.metadata.get("flow_type", "standard")
            flow_path = event.metadata.get("path") or (
                CRYPTO_PATH if flow_type == "crypto" else STANDARD_PATH
            )
            state = TransactionState(
                transaction_id=event.transaction_id,
                flow_type=flow_type,
                flow_path=flow_path,
                nodes={},
                seen_event_ids=set(),
                last_updated=received_at,
                missing_reported=set(),
            )
            self._states[event.transaction_id] = state

        incidents: list[Incident] = []
        node_status: dict[str, NodeStatus] = {}
        edge_status: dict[tuple[str, str], EdgeStatus] = {}
        animated_edges: set[tuple[str, str]] = set()

        if event.event_id in state.seen_event_ids:
            incident = build_incident(
                transaction_id=event.transaction_id,
                incident_type=IncidentType.DUPLICATE_EVENT,
                message="Duplicate event detected",
                affected_nodes=[event.node_id],
                severity=IncidentSeverity.MEDIUM,
                edge=None,
            )
            incidents.append(incident)
            node_status[event.node_id] = NodeStatus.DUPLICATE
        else:
            state.seen_event_ids.add(event.event_id)

        state.nodes[event.node_id] = NodeObservation(
            event=event,
            received_at=received_at,
            status=NodeStatus.HEALTHY,
            duplicates=0,
        )
        state.last_updated = received_at

        delay_ms = (received_at - event.timestamp).total_seconds() * 1000
        if delay_ms > self._settings.delay_threshold_ms:
            incident = build_incident(
                transaction_id=event.transaction_id,
                incident_type=IncidentType.DELAYED_EVENT,
                message=f"Delayed event arrival ({delay_ms:.0f}ms)",
                affected_nodes=[event.node_id],
                severity=IncidentSeverity.LOW,
                edge=None,
            )
            incidents.append(incident)
            node_status[event.node_id] = NodeStatus.DELAYED

        incidents.extend(self._detect_mismatches(state, edge_status))

        if event.node_id in state.flow_path:
            index = state.flow_path.index(event.node_id)
            if index > 0:
                animated_edges.add((state.flow_path[index - 1], event.node_id))

        for incident in incidents:
            for node in incident.affected_nodes:
                node_status[node] = node_status_from_incident(incident)
            self._active_incidents[incident.incident_id] = incident

        mismatch_present = any(
            incident.type
            in {
                IncidentType.AMOUNT_MISMATCH,
                IncidentType.FEE_MISMATCH,
                IncidentType.FX_MISMATCH,
            }
            for incident in incidents
        )
        self._metrics.record_event(received_at, event.timestamp, mismatch_present)

        snapshot = build_snapshot(state, edge_status, node_status, animated_edges)
        metrics = self._metrics.snapshot(active_incidents=len(self._active_incidents))
        return StoreResult(snapshot=snapshot, incidents=incidents, metrics=metrics)

    def check_missing(self) -> list[StoreResult]:
        now = now_utc()
        self._prune_incidents(now)
        results: list[StoreResult] = []
        for state in list(self._states.values()):
            if (now - state.last_updated).total_seconds() * 1000 < self._settings.missing_threshold_ms:
                continue
            missing_nodes = [node for node in state.flow_path if node not in state.nodes]
            new_missing = [node for node in missing_nodes if node not in state.missing_reported]
            if not new_missing:
                continue
            incidents: list[Incident] = []
            node_status: dict[str, NodeStatus] = {}
            edge_status: dict[tuple[str, str], EdgeStatus] = {}
            for node in new_missing:
                edge = self._edge_for_missing(state.flow_path, node)
                incident = build_incident(
                    transaction_id=state.transaction_id,
                    incident_type=IncidentType.MISSING_HOP,
                    message=f"Missing expected hop: {node}",
                    affected_nodes=[node],
                    severity=IncidentSeverity.HIGH,
                    edge=edge,
                )
                incidents.append(incident)
                node_status[node] = NodeStatus.MISSING
                if edge:
                    source, target = edge.split("->")
                    edge_status[(source, target)] = EdgeStatus.MISSING
                state.missing_reported.add(node)
                self._active_incidents[incident.incident_id] = incident

            snapshot = build_snapshot(state, edge_status, node_status, set())
            metrics = self._metrics.snapshot(active_incidents=len(self._active_incidents))
            results.append(StoreResult(snapshot=snapshot, incidents=incidents, metrics=metrics))
        return results

    def _edge_for_missing(self, path: list[str], node: str) -> str | None:
        if node not in path:
            return None
        index = path.index(node)
        if index == 0:
            return None
        return f"{path[index - 1]}->{node}"

    def _detect_mismatches(
        self, state: TransactionState, edge_status: dict[tuple[str, str], EdgeStatus]
    ) -> list[Incident]:
        incidents: list[Incident] = []
        nodes = state.nodes

        def mark_edge(source: str, target: str, status: EdgeStatus) -> None:
            edge_status[(source, target)] = status

        if "merchant" in nodes and "gateway" in nodes:
            merchant = nodes["merchant"].event
            gateway = nodes["gateway"].event
            expected = merchant.amount + gateway.fee
            if not approx_equal(gateway.amount, expected):
                incidents.append(
                    build_incident(
                        transaction_id=state.transaction_id,
                        incident_type=IncidentType.FEE_MISMATCH,
                        message="Gateway fee mismatch",
                        affected_nodes=["merchant", "gateway"],
                        severity=IncidentSeverity.HIGH,
                        edge="merchant->gateway",
                    )
                )
                mark_edge("merchant", "gateway", EdgeStatus.MISMATCH)

        if "gateway" in nodes and "bank" in nodes and "crypto_exchange" not in state.flow_path:
            gateway = nodes["gateway"].event
            bank = nodes["bank"].event
            expected = gateway.amount - bank.fee
            if not approx_equal(bank.amount, expected):
                incidents.append(
                    build_incident(
                        transaction_id=state.transaction_id,
                        incident_type=IncidentType.AMOUNT_MISMATCH,
                        message="Bank settlement mismatch",
                        affected_nodes=["gateway", "bank"],
                        severity=IncidentSeverity.HIGH,
                        edge="gateway->bank",
                    )
                )
                mark_edge("gateway", "bank", EdgeStatus.MISMATCH)

        if "gateway" in nodes and "crypto_exchange" in nodes:
            gateway = nodes["gateway"].event
            crypto = nodes["crypto_exchange"].event
            network_fee = crypto.metadata.get("network_fee", 0.0)
            expected = gateway.amount - network_fee
            if not approx_equal(crypto.amount, expected):
                incidents.append(
                    build_incident(
                        transaction_id=state.transaction_id,
                        incident_type=IncidentType.AMOUNT_MISMATCH,
                        message="Crypto network fee mismatch",
                        affected_nodes=["gateway", "crypto_exchange"],
                        severity=IncidentSeverity.HIGH,
                        edge="gateway->crypto_exchange",
                    )
                )
                mark_edge("gateway", "crypto_exchange", EdgeStatus.MISMATCH)

            fx_rate = crypto.metadata.get("fx_rate")
            converted_amount = crypto.metadata.get("converted_amount")
            if fx_rate and converted_amount:
                expected_fx = crypto.amount * fx_rate
                if not approx_equal(converted_amount, expected_fx):
                    incidents.append(
                        build_incident(
                            transaction_id=state.transaction_id,
                            incident_type=IncidentType.FX_MISMATCH,
                            message="FX conversion mismatch",
                            affected_nodes=["crypto_exchange"],
                            severity=IncidentSeverity.MEDIUM,
                            edge="gateway->crypto_exchange",
                        )
                    )
                    mark_edge("gateway", "crypto_exchange", EdgeStatus.MISMATCH)

        if "crypto_exchange" in nodes and "bank" in nodes:
            crypto = nodes["crypto_exchange"].event
            bank = nodes["bank"].event
            base_amount = crypto.metadata.get("converted_amount", crypto.amount)
            expected = base_amount - bank.fee
            if not approx_equal(bank.amount, expected):
                incidents.append(
                    build_incident(
                        transaction_id=state.transaction_id,
                        incident_type=IncidentType.AMOUNT_MISMATCH,
                        message="Settlement mismatch after FX",
                        affected_nodes=["crypto_exchange", "bank"],
                        severity=IncidentSeverity.HIGH,
                        edge="crypto_exchange->bank",
                    )
                )
                mark_edge("crypto_exchange", "bank", EdgeStatus.MISMATCH)

        return incidents

    def _prune_incidents(self, now: datetime) -> None:
        ttl = timedelta(minutes=self._settings.incident_ttl_minutes)
        cutoff = now - ttl
        expired = [
            incident_id
            for incident_id, incident in self._active_incidents.items()
            if incident.timestamp < cutoff
        ]
        for incident_id in expired:
            self._active_incidents.pop(incident_id, None)
