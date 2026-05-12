import { memo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeProps,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

import { graphSemanticFingerprint } from "../lib/graphFingerprint";
import { flowLabel } from "../lib/humanize";
import { formatPaymentRail, GraphSnapshot, NodeStatus } from "../types";

const statusColor: Record<NodeStatus, string> = {
  healthy: "#16a34a",
  delayed: "#f59e0b",
  mismatch: "#ef4444",
  missing: "#ef4444",
  duplicate: "#f97316",
  unknown: "#94a3b8",
};

const StatusNode = ({ data }: NodeProps) => {
  return (
    <div className="rounded-xl border border-black/10 bg-white/90 px-4 py-3 shadow-md">
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="text-xs uppercase tracking-wide text-slate-400">{data.role}</div>
      <div className="text-base font-semibold text-slate-900">{data.label}</div>
      {typeof data.amount === "number" && (
        <div className="mt-2 text-xs text-slate-600">
          <div>
            Amount <span className="font-mono">{data.amount.toFixed(2)}</span>
          </div>
          <div>
            Fee{" "}
            <span className="font-mono">
              {typeof data.fee === "number" ? data.fee.toFixed(2) : "0.00"}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-wide">{data.currency}</div>
          {Array.isArray(data.metaLines) && data.metaLines.length > 0 && (
            <div className="mt-2 border-t border-black/5 pt-2 text-[10px] leading-relaxed text-slate-500">
              {data.metaLines.map((line: string, i: number) => (
                <div key={`${line}-${i}`}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const nodeTypes = { status: StatusNode };

interface GraphPanelProps {
  graph: GraphSnapshot | null;
}

const GraphPanel = ({ graph }: GraphPanelProps) => {
  if (!graph) {
    return (
      <div className="vf-card flex min-h-[380px] items-center justify-center p-6">
        <div className="text-center">
          <div className="text-lg font-semibold">Waiting for transaction flow</div>
          <p className="vf-subtle mt-2">Start the simulators to stream events.</p>
        </div>
      </div>
    );
  }

  const isCrypto = graph.flow_type === "crypto" || graph.payment_rail === "crypto_settlement";
  const cardClass = isCrypto
    ? "vf-card vf-grid-glow min-h-[380px] p-4 ring-2 ring-violet-400/50 bg-violet-50/50"
    : "vf-card vf-grid-glow min-h-[380px] p-4";

  const nodes = graph.nodes.map((node, index) => {
    const sm = node.source_metadata ?? {};
    const metaLines = Object.entries(sm)
      .slice(0, 8)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
    return {
      id: node.id,
      type: "status",
      position: { x: index * 240, y: 0 },
      data: {
        role: node.label,
        label: node.id,
        amount: node.amount,
        fee: node.fee,
        currency: node.currency,
        metaLines,
      },
      style: {
        borderColor: statusColor[node.status],
        boxShadow: `0 0 0 2px ${statusColor[node.status]}22`,
      },
    };
  });

  const edges = graph.edges.map((edge) => {
    const color = statusColor[edge.status as NodeStatus] || "#64748b";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.animated,
      style: {
        stroke: color,
        strokeWidth: 2.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
    };
  });

  const isComplete = graph.nodes.length > 0 && graph.nodes.every((node) => node.status !== "unknown");
  const statusLabel = isComplete ? "Completed" : "Live";
  const statusClass = isComplete ? "vf-status vf-status-complete" : "vf-status vf-status-live";

  return (
    <div className={cardClass}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Graph</div>
          {isCrypto && (
            <div className="mb-1 inline-block rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Bridge
            </div>
          )}
          {!isCrypto && graph.payment_rail && graph.payment_rail !== "unspecified" && (
            <div className="mb-1 inline-block rounded-full bg-slate-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {formatPaymentRail(graph.payment_rail)}
            </div>
          )}
          <div className="text-lg font-semibold">
            {graph.transaction_id} · {flowLabel(graph.flow_type)}
          </div>
          <div className="text-xs text-slate-500">
            Updated {new Date(graph.updated_at).toLocaleTimeString()}
          </div>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="h-[320px]">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
          <Background gap={24} color="#e2e8f0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
};

export default memo(GraphPanel, (prev, next) => {
  return graphSemanticFingerprint(prev.graph) === graphSemanticFingerprint(next.graph);
});
