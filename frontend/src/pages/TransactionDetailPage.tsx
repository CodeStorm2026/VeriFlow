import { useState } from "react";

import GraphPanel from "../components/GraphPanel";
import ReplayControls from "../components/ReplayControls";
import { GraphSnapshot } from "../types";

interface TransactionDetailPageProps {
  txId: string;
  graph: GraphSnapshot | null;
  replayMode: boolean;
  bufferSize: number;
  onReplay: () => void;
  onStop: () => void;
  onBack: () => void;
}

const TransactionDetailPage = ({
  txId,
  graph,
  replayMode,
  bufferSize,
  onReplay,
  onStop,
  onBack,
}: TransactionDetailPageProps) => {
  const [resolutionMode, setResolutionMode] = useState<"ai" | "manual">("ai");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState<string | null>(null);
  const isComplete = graph?.nodes.length
    ? graph.nodes.every((node) => node.status !== "unknown")
    : false;
  const statusLabel = isComplete ? "Completed" : "Monitoring";
  const statusClass = isComplete ? "vf-status vf-status-complete" : "vf-status vf-status-live";
  const updatedAt = graph?.updated_at ? new Date(graph.updated_at).toLocaleTimeString() : "--";

  const handleResolution = () => {
    if (resolutionMode === "ai") {
      setResolutionStatus("AI resolution queued. Automated remediation in progress.");
      return;
    }
    setResolutionStatus("Manual review opened. Analyst task created.");
  };

  return (
    <div className="space-y-6">
      <div className="vf-detail-header">
        <div>
          <div className="vf-detail-eyebrow">Transaction detail</div>
          <div className="vf-detail-title">{txId || "Awaiting transaction"}</div>
        </div>
        <div className="vf-detail-actions">
          <span className={statusClass}>{statusLabel}</span>
          <button onClick={onBack} className="vf-button vf-button-ghost">
            Back to table
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_0.7fr]">
        <div className="space-y-6">
          <GraphPanel graph={graph} />
          <ReplayControls
            isReplaying={replayMode}
            bufferSize={bufferSize}
            onReplay={onReplay}
            onStop={onStop}
          />
        </div>
        <div className="space-y-4">
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Transaction summary</div>
            <div className="vf-summary-grid">
              <div>
                <div className="vf-summary-label">Last update</div>
                <div className="vf-summary-value">{updatedAt}</div>
              </div>
              <div>
                <div className="vf-summary-label">Refresh cadence</div>
                <div className="vf-summary-value">15 seconds</div>
              </div>
              <div>
                <div className="vf-summary-label">Flow type</div>
                <div className="vf-summary-value">{graph?.flow_type ?? "--"}</div>
              </div>
              <div>
                <div className="vf-summary-label">Nodes tracked</div>
                <div className="vf-summary-value">{graph?.nodes.length ?? 0}</div>
              </div>
            </div>
          </div>
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Graph status</div>
            <div className="vf-subtle">
              Live updates are throttled to reduce jitter. Completed flows pause updates.
            </div>
          </div>
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Resolution workspace</div>
            <div className="vf-subtle">
              Choose how to resolve the mismatch before releasing funds.
            </div>
            <div className="vf-toggle-group">
              <button
                type="button"
                className={`vf-toggle ${resolutionMode === "ai" ? "vf-toggle-active" : ""}`}
                onClick={() => setResolutionMode("ai")}
              >
                AI auto resolution
              </button>
              <button
                type="button"
                className={`vf-toggle ${resolutionMode === "manual" ? "vf-toggle-active" : ""}`}
                onClick={() => setResolutionMode("manual")}
              >
                Manual review
              </button>
            </div>
            {resolutionMode === "ai" ? (
              <div className="vf-ai-panel">
                AI will analyze ledger parity, suggested refunds, and regulatory risk.
                <ul>
                  <li>Auto-compare ledger & gateway totals</li>
                  <li>Propose adjustment entries</li>
                  <li>Notify compliance if risk score is high</li>
                </ul>
              </div>
            ) : (
              <textarea
                className="vf-textarea"
                placeholder="Add manual review notes for the analyst team"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
              />
            )}
            <button
              type="button"
              onClick={handleResolution}
              className="vf-button vf-button-primary w-full"
            >
              Apply decision
            </button>
            {resolutionStatus && (
              <div className="vf-subtle mt-2">{resolutionStatus}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailPage;
