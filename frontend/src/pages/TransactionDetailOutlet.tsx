import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import TransactionDetailPage from "./TransactionDetailPage";
import type { GraphSnapshot } from "../types";

export interface TransactionDetailOutletProps {
  graphs: Record<string, GraphSnapshot>;
  displayGraph: GraphSnapshot | null;
  setActiveTx: (id: string | null) => void;
  setDisplayGraph: Dispatch<SetStateAction<GraphSnapshot | null>>;
  replayMode: boolean;
  replayBuffer: MutableRefObject<Record<string, GraphSnapshot[]>>;
  lastGraphUpdateRef: MutableRefObject<number>;
  apiUrl: string;
  onReplay: () => void;
  onStop: () => void;
  onBack: () => void;
  loadHistory: (txId: string) => Promise<void>;
}

/**
 * Stable route component (must not be defined inside App) so React does not remount the detail
 * view on every parent re-render when WebSocket traffic updates global state.
 */
export default function TransactionDetailOutlet({
  graphs,
  displayGraph,
  setActiveTx,
  setDisplayGraph,
  replayMode,
  replayBuffer,
  lastGraphUpdateRef,
  apiUrl,
  onReplay,
  onStop,
  onBack,
  loadHistory,
}: TransactionDetailOutletProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const txId = id ?? "";

  useEffect(() => {
    if (!id) {
      navigate("/", { replace: true });
      return;
    }
    setActiveTx(id);
    setDisplayGraph(graphs[id] ?? null);
    lastGraphUpdateRef.current = 0;
    void loadHistory(id);
    // Only re-run when the route id changes. `graphs` is omitted so WebSocket updates do not reset the detail session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate, loadHistory]);

  const bufferSize = txId ? (replayBuffer.current[txId]?.length ?? 0) : 0;
  const currentGraph =
    displayGraph && displayGraph.transaction_id === txId ? displayGraph : graphs[txId] ?? null;

  return (
    <TransactionDetailPage
      txId={txId}
      graph={currentGraph}
      replayMode={replayMode}
      bufferSize={bufferSize}
      apiUrl={apiUrl}
      onReplay={onReplay}
      onStop={onStop}
      onBack={onBack}
    />
  );
}
