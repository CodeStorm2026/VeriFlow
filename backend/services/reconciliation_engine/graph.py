from __future__ import annotations

from datetime import datetime

from common.models import (
    EdgeStatus,
    GraphEdge,
    GraphNode,
    GraphSnapshot,
    NodeStatus,
)
from common.types import TransactionState
from common.utils import now_utc


def build_snapshot(
    state: TransactionState,
    edge_status: dict[tuple[str, str], EdgeStatus],
    node_status: dict[str, NodeStatus],
    animated_edges: set[tuple[str, str]],
) -> GraphSnapshot:
    nodes: list[GraphNode] = []
    for node_id in state.flow_path:
        if node_id in state.nodes:
            observation = state.nodes[node_id]
            nodes.append(
                GraphNode(
                    id=node_id,
                    label=node_id.replace("_", " ").title(),
                    status=node_status.get(node_id, observation.status),
                    amount=observation.event.amount,
                    fee=observation.event.fee,
                    currency=observation.event.currency,
                    timestamp=observation.event.timestamp,
                )
            )
        else:
            nodes.append(
                GraphNode(
                    id=node_id,
                    label=node_id.replace("_", " ").title(),
                    status=node_status.get(node_id, NodeStatus.UNKNOWN),
                )
            )

    edges: list[GraphEdge] = []
    for index in range(len(state.flow_path) - 1):
        source = state.flow_path[index]
        target = state.flow_path[index + 1]
        status = edge_status.get((source, target), EdgeStatus.HEALTHY)
        edges.append(
            GraphEdge(
                id=f"{source}->{target}",
                source=source,
                target=target,
                status=status,
                animated=(source, target) in animated_edges,
                last_event_id=state.nodes.get(target).event.event_id if target in state.nodes else None,
            )
        )

    return GraphSnapshot(
        transaction_id=state.transaction_id,
        flow_type=state.flow_type,
        path=state.flow_path,
        nodes=nodes,
        edges=edges,
        updated_at=now_utc(),
    )
