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

_GRAPH_META_KEYS = (
    "fee_model",
    "fee_rate",
    "fee_basis",
    "fee_payer",
    "ledger_adjustment",
    "bank_display",
    "tx_kind",
    "payment_rail",
    "transfer_scheme",
    "policy_max_bank_fee_vs_gateway",
    "settlement_rail",
    "network_rail",
    "asset_leg",
    "payout_method",
    "from_account_label",
    "beneficiary_name",
    "beneficiary_account",
    "payment_purpose",
    "bridge_asset",
    "bridge_chain",
    "mint_to_address",
    "bridge_memo",
)


def _source_metadata(metadata: dict) -> dict:
    return {k: metadata[k] for k in _GRAPH_META_KEYS if k in metadata}


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
            adj = state.virtual_node_adjustments.get(node_id, 0.0)
            base_amt = observation.event.amount
            display_amount = round(base_amt + adj, 2) if adj else base_amt
            meta = dict(_source_metadata(observation.event.metadata))
            if adj:
                meta["ledger_adjustment"] = adj
                meta["bank_display"] = "settlement_aligned"
            nodes.append(
                GraphNode(
                    id=node_id,
                    label=node_id.replace("_", " ").title(),
                    status=node_status.get(node_id, observation.status),
                    amount=display_amount,
                    fee=observation.event.fee,
                    currency=observation.event.currency,
                    timestamp=observation.event.timestamp,
                    source_metadata=meta,
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
                last_event_id=state.nodes[target].event.event_id
                if target in state.nodes
                else None,
            )
        )

    return GraphSnapshot(
        transaction_id=state.transaction_id,
        flow_type=state.flow_type,
        path=state.flow_path,
        payment_rail=state.payment_rail,
        nodes=nodes,
        edges=edges,
        updated_at=now_utc(),
    )
