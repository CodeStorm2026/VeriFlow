import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeProps,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

import { GraphSnapshot, NodeStatus } from "../types";

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
            amount: <span className="font-mono">{data.amount.toFixed(2)}</span>
          </div>
          <div>
            fee:{" "}
            <span className="font-mono">
              {typeof data.fee === "number" ? data.fee.toFixed(2) : "0.00"}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-wide">{data.currency}</div>
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

  const nodes = graph.nodes.map((node, index) => ({
    id: node.id,
    type: "status",
    position: { x: index * 240, y: 0 },
    data: {
      role: node.label,
      label: node.id,
      amount: node.amount,
      fee: node.fee,
      currency: node.currency,
    },
    style: {
      borderColor: statusColor[node.status],
      boxShadow: `0 0 0 2px ${statusColor[node.status]}22`,
    },
  }));

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

  return (
    <div className="vf-card vf-grid-glow min-h-[380px] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Live Graph</div>
          <div className="text-lg font-semibold">
            {graph.transaction_id} - {graph.flow_type}
          </div>
        </div>
        <div className="vf-pill bg-emerald-100 text-emerald-700">Live</div>
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

export default GraphPanel;
