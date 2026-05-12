import { memo, useState } from "react";

import GraphPanel from "../components/GraphPanel";
import ReplayControls from "../components/ReplayControls";
import { graphSemanticFingerprint } from "../lib/graphFingerprint";
import { flowLabel } from "../lib/humanize";
import { formatPaymentRail, GraphSnapshot } from "../types";

interface TransactionDetailPageProps {
  txId: string;
  graph: GraphSnapshot | null;
  replayMode: boolean;
  bufferSize: number;
  apiUrl: string;
  onReplay: () => void;
  onStop: () => void;
  onBack: () => void;
}

function TransactionDetailPage({
  txId,
  graph,
  replayMode,
  bufferSize,
  apiUrl,
  onReplay,
  onStop,
  onBack,
}: TransactionDetailPageProps) {
  const [resolutionMode, setResolutionMode] = useState<"ai" | "manual">("ai");
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState<string | null>(null);
  const [deltaAmount, setDeltaAmount] = useState("0.5");
  const [correctionNode, setCorrectionNode] = useState("gateway");
  const [correctionResult, setCorrectionResult] = useState<string | null>(null);

  const isComplete = graph?.nodes.length
    ? graph.nodes.every((node) => node.status !== "unknown")
    : false;
  const statusLabel = isComplete ? "Done" : "Live";
  const statusClass = isComplete ? "vf-status vf-status-complete" : "vf-status vf-status-live";
  const updatedAt = graph?.updated_at ? new Date(graph.updated_at).toLocaleTimeString() : "--";

  const merchantMeta = graph?.nodes.find((n) => n.id === "merchant")?.source_metadata;
  const txKind =
    typeof merchantMeta?.tx_kind === "string" ? (merchantMeta.tx_kind as string) : "—";
  const instrumentLabel =
    txKind === "card" ? "Card" : txKind === "transfer" ? "Transfer" : txKind;

  const handleResolution = () => {
    if (resolutionMode === "ai") {
      setResolutionStatus("AI queued.");
      return;
    }
    setResolutionStatus("Manual task opened.");
  };

  const submitMockCorrection = async () => {
    const delta = Number.parseFloat(deltaAmount);
    if (!Number.isFinite(delta) || !txId) {
      setCorrectionResult("Invalid delta or transaction.");
      return;
    }
    try {
      const res = await fetch(`${apiUrl}/mock/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: txId,
          node_id: correctionNode,
          delta_amount: delta,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        auto_eligible?: boolean;
        autocorrect_max_delta?: number;
      } | null;
      if (!res.ok) {
        setCorrectionResult("Request failed.");
        return;
      }
      const eligible = body?.auto_eligible === true;
      setCorrectionResult(
        eligible ? "Logged · in auto band." : "Logged · review."
      );
    } catch {
      setCorrectionResult("Network error.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="vf-detail-header">
        <div>
          <div className="vf-detail-eyebrow">Detail</div>
          <div className="vf-detail-title">{txId || "Awaiting transaction"}</div>
        </div>
        <div className="vf-detail-actions">
          <span className={statusClass}>{statusLabel}</span>
          <button onClick={onBack} className="vf-button vf-button-ghost">
            Back
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
            <div className="text-sm font-semibold">Summary</div>
            <div className="vf-summary-grid">
              <div>
                <div className="vf-summary-label">Updated</div>
                <div className="vf-summary-value">{updatedAt}</div>
              </div>
              <div>
                <div className="vf-summary-label">Poll</div>
                <div className="vf-summary-value">15 seconds</div>
              </div>
              <div>
                <div className="vf-summary-label">Flow</div>
                <div className="vf-summary-value">{flowLabel(graph?.flow_type)}</div>
              </div>
              <div>
                <div className="vf-summary-label">Path</div>
                <div className="vf-summary-value">
                  {graph?.flow_type === "crypto" || graph?.payment_rail === "crypto_settlement"
                    ? "Bridge"
                    : graph?.payment_rail === "bank_transfer"
                      ? "Transfer"
                      : "Card"}
                </div>
              </div>
              <div>
                <div className="vf-summary-label">Rail</div>
                <div className="vf-summary-value">{formatPaymentRail(graph?.payment_rail)}</div>
              </div>
              <div>
                <div className="vf-summary-label">Instrument</div>
                <div className="vf-summary-value">{instrumentLabel}</div>
              </div>
              <div>
                <div className="vf-summary-label">Hops</div>
                <div className="vf-summary-value">{graph?.nodes.length ?? 0}</div>
              </div>
            </div>
          </div>
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Graph</div>
            <div className="vf-subtle text-xs">Detail view throttles churn.</div>
          </div>
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Mock correction</div>
            <div className="vf-subtle mb-3 text-xs">Demo. Δ cap enforced server-side.</div>
            <label className="vf-subtle mb-1 block text-xs">Hop</label>
            <select
              className="vf-textarea mb-2 py-1"
              value={correctionNode}
              onChange={(e) => setCorrectionNode(e.target.value)}
            >
              <option value="merchant">Merchant</option>
              <option value="gateway">Gateway</option>
              <option value="bank">Bank</option>
              <option value="crypto_exchange">Bridge desk</option>
            </select>
            <label className="vf-subtle mb-1 block text-xs">Delta</label>
            <input
              className="vf-textarea mb-2 py-1"
              value={deltaAmount}
              onChange={(e) => setDeltaAmount(e.target.value)}
            />
            <button
              type="button"
              className="vf-button vf-button-primary w-full"
              onClick={submitMockCorrection}
            >
              Submit
            </button>
            {correctionResult && <div className="vf-subtle mt-2 text-xs">{correctionResult}</div>}
          </div>
          <div className="vf-card p-4">
            <div className="text-sm font-semibold">Resolution</div>
            <div className="vf-subtle mb-2 text-xs">Demo paths.</div>
            <div className="vf-toggle-group">
              <button
                type="button"
                className={`vf-toggle ${resolutionMode === "ai" ? "vf-toggle-active" : ""}`}
                onClick={() => setResolutionMode("ai")}
              >
                AI
              </button>
              <button
                type="button"
                className={`vf-toggle ${resolutionMode === "manual" ? "vf-toggle-active" : ""}`}
                onClick={() => setResolutionMode("manual")}
              >
                Manual
              </button>
            </div>
            {resolutionMode === "ai" ? (
              <div className="vf-ai-panel text-sm">
                Totals, adjustments, compliance if high risk.
              </div>
            ) : (
              <textarea
                className="vf-textarea"
                placeholder="Notes"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
              />
            )}
            <button
              type="button"
              onClick={handleResolution}
              className="vf-button vf-button-primary w-full"
            >
              Apply
            </button>
            {resolutionStatus && (
              <div className="vf-subtle mt-2">{resolutionStatus}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(TransactionDetailPage, (prev, next) => {
  return (
    prev.txId === next.txId &&
    prev.replayMode === next.replayMode &&
    prev.bufferSize === next.bufferSize &&
    prev.apiUrl === next.apiUrl &&
    prev.onReplay === next.onReplay &&
    prev.onStop === next.onStop &&
    prev.onBack === next.onBack &&
    graphSemanticFingerprint(prev.graph) === graphSemanticFingerprint(next.graph)
  );
});
