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
  nodes: GraphNode[];
  edges: GraphEdge[];
  updated_at: string;
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
}

export interface MetricSeries {
  ts: string;
  tx_per_sec: number;
  mismatch_rate: number;
  reconciliation_latency_ms: number;
}

export interface WsMessage {
  type: "graph" | "incident" | "metrics" | "bootstrap" | "log";
  payload: any;
}
