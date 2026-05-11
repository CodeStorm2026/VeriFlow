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
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Transaction detail</div>
          <div className="text-lg font-semibold text-slate-900">
            {txId || "Awaiting transaction"}
          </div>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl border border-black/10 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600"
        >
          Back to table
        </button>
      </div>

      <GraphPanel graph={graph} />

      <ReplayControls
        isReplaying={replayMode}
        bufferSize={bufferSize}
        onReplay={onReplay}
        onStop={onStop}
      />
    </div>
  );
};

export default TransactionDetailPage;
