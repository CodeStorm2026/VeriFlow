export type NodeStatus =
  | "healthy"
  | "delayed"
  | "mismatch"
  | "missing"
  | "duplicate"
  | "unknown";

export type EdgeStatus = "healthy" | "delayed" | "mismatch" | "missing";

export interface GraphNode {
  id: string;
  label: string;
  status: NodeStatus;
  amount?: number;
  fee?: number;
  currency?: string;
  timestamp?: string;
  source_metadata?: Record<string, string | number>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  status: EdgeStatus;
  animated?: boolean;
  last_event_id?: string;
}

export interface GraphSnapshot {
  transaction_id: string;
  flow_type: string;
  path: string[];
  /** Merchant-settlement rail: card_acquiring | bank_transfer | crypto_settlement | unspecified */
  payment_rail?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
}

export function formatPaymentRail(rail: string | undefined): string {
  switch (rail) {
    case "card_acquiring":
      return "Card acquiring";
    case "bank_transfer":
      return "Bank transfer";
    case "crypto_settlement":
      return "Crypto settlement";
    case "unspecified":
      return "—";
    default:
      return rail?.trim() ? rail : "—";
  }
}

export interface Incident {
  incident_id: string;
  transaction_id: string;
  type: string;
  severity: string;
  message: string;
  confidence: number;
  affected_nodes: string[];
  edge?: string | null;
  timestamp: string;
}

export interface MetricsSnapshot {
  tx_per_sec: number;
  mismatch_rate: number;
  reconciliation_latency_ms: number;
  active_incidents: number;
  updated_at: string;
  events_in_window?: number;
  mismatch_events_in_window?: number;
  node_events?: Record<string, number>;
}

export interface MetricSeries {
  ts: string;
  tx_per_sec: number;
  mismatch_rate: number;
  reconciliation_latency_ms: number;
  active_incidents?: number;
  events_in_window?: number;
}

export interface WsMessage {
  type:
    | "graph"
    | "incident"
    | "metrics"
    | "bootstrap"
    | "log"
    | "escalation_pending"
    | "escalation_due"
    | "source_health"
    | "correction";
  payload: any;
}
