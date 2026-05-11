interface ReplayControlsProps {
  isReplaying: boolean;
  bufferSize: number;
  onReplay: () => void;
  onStop: () => void;
}

const ReplayControls = ({ isReplaying, bufferSize, onReplay, onStop }: ReplayControlsProps) => {
  return (
    <div className="vf-card flex items-center justify-between p-4">
      <div>
        <div className="text-sm font-semibold">Replay mode</div>
        <div className="vf-subtle">Buffered snapshots: {bufferSize}</div>
      </div>
      <div className="flex gap-2">
        {!isReplaying ? (
          <button
            onClick={onReplay}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Replay
          </button>
        ) : (
          <button
            onClick={onStop}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
};

export default ReplayControls;
