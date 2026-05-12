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
        <div className="text-sm font-semibold">Replay</div>
        <div className="vf-subtle">Buf {bufferSize}</div>
      </div>
      <div className="flex gap-2">
        {!isReplaying ? (
          <button
            onClick={onReplay}
            className="vf-button vf-button-primary"
          >
            Replay
          </button>
        ) : (
          <button
            onClick={onStop}
            className="vf-button vf-button-ghost"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
};

export default ReplayControls;
